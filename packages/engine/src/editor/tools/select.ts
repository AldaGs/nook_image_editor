// Select tool: tap to select (tap again on the same spot to cycle through
// overlapping layers), drag to move, drag handles to resize or rotate.
// On empty space a finger pans and a mouse draws a marquee; in multi-select
// mode a finger draws a marquee too.

import { apply, invert, multiply, rotation, translation, type Affine, type Point } from '../../geom/affine.ts';
import type { Node } from '../../doc/types.ts';
import { localBox } from '../bounds.ts';
import { handleAt, handlesFor, type Handle } from '../handles.ts';
import { hitStack, marqueeHits } from '../hit.ts';
import { dragThreshold, hitRadius, type PointerInfo, type Tool, type ToolContext } from './tool.ts';

type Mode =
  | { kind: 'idle' }
  | { kind: 'press'; hit: Node | null; stack: Node[] }    // down, not yet a drag
  | { kind: 'move'; nodes: Node[]; start: Map<string, Affine> }
  | { kind: 'resize'; node: Node; handle: Handle; t0: Affine; w0: number; h0: number }
  | { kind: 'rotate'; node: Node; t0: Affine; centre: Point; a0: number }
  | { kind: 'marquee'; base: string[] }
  | { kind: 'pan'; last: Point };

const SNAP_ANGLE = Math.PI / 12; // 15°

export class SelectTool implements Tool {
  private mode: Mode = { kind: 'idle' };
  private downAt: PointerInfo | null = null;
  private lastTap: { screen: Point; time: number } | null = null;

  private ctx: ToolContext;

  constructor(ctx: ToolContext) { this.ctx = ctx; }

  down(p: PointerInfo): void {
    const { editor, camera } = this.ctx;
    this.downAt = p;

    // Handles win over everything under them.
    const handle = handleAt(handlesFor(editor, camera), p.screen, hitRadius(p));
    const node = editor.selectedNodes()[0];
    if (handle && node) {
      editor.history.begin(handle.id === 'rotate' ? 'Rotate' : 'Resize');
      if (handle.id === 'rotate') {
        const box = localBox(editor.doc, node);
        const centre = apply(editor.doc.worldTransform(node.id), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
        this.mode = { kind: 'rotate', node, t0: node.transform, centre, a0: Math.atan2(p.world.y - centre.y, p.world.x - centre.x) };
      } else {
        this.mode = { kind: 'resize', node, handle, t0: node.transform, w0: node.width, h0: node.height };
      }
      return;
    }

    const stack = hitStack(editor.doc, editor.pageId, p.world, hitRadius(p) / 3 / camera.zoom);
    this.mode = { kind: 'press', hit: stack[0] ?? null, stack };
  }

  move(p: PointerInfo): void {
    const { editor, camera } = this.ctx;
    const start = this.downAt;
    if (!start) return;
    const m = this.mode;

    if (m.kind === 'press') {
      if (Math.hypot(p.screen.x - start.screen.x, p.screen.y - start.screen.y) < dragThreshold(p)) return;
      this.mode = this.startDrag(m.hit, p);
    }

    const dx = p.world.x - start.world.x, dy = p.world.y - start.world.y;
    const mode = this.mode;
    switch (mode.kind) {
      case 'move':
        editor.history.rewind();
        editor.transact('Move', () => editor.moveOps(mode.nodes, mode.start, dx, dy));
        break;
      case 'resize':
        editor.history.rewind();
        this.resize(mode, p);
        break;
      case 'rotate':
        editor.history.rewind();
        this.rotate(mode, p);
        break;
      case 'marquee': {
        const r = { x: Math.min(start.world.x, p.world.x), y: Math.min(start.world.y, p.world.y), width: Math.abs(dx), height: Math.abs(dy) };
        editor.marquee = r;
        const hits = marqueeHits(editor.doc, editor.pageId, r).map(n => n.id);
        editor.select([...mode.base, ...hits]);
        break;
      }
      case 'pan':
        camera.panBy(p.screen.x - mode.last.x, p.screen.y - mode.last.y);
        mode.last = p.screen;
        this.ctx.invalidate();
        break;
    }
  }

  up(p: PointerInfo): void {
    const { editor } = this.ctx;
    const m = this.mode;
    if (m.kind === 'press') this.tap(m.stack, p);
    if (m.kind === 'move' || m.kind === 'resize' || m.kind === 'rotate') editor.history.commit();
    if (m.kind === 'marquee') { editor.marquee = null; editor.emit(); }
    this.mode = { kind: 'idle' };
    this.downAt = null;
  }

  cancel(): void {
    const { editor } = this.ctx;
    if (this.mode.kind === 'move' || this.mode.kind === 'resize' || this.mode.kind === 'rotate') editor.history.cancel();
    if (this.mode.kind === 'marquee') { editor.marquee = null; editor.emit(); }
    this.mode = { kind: 'idle' };
    this.downAt = null;
  }

  // ── Press → drag ─────────────────────────────────────────────

  private startDrag(hit: Node | null, p: PointerInfo): Mode {
    const { editor } = this.ctx;
    const additive = p.shift || editor.multiSelect;
    const selected = hit && editor.selection.includes(hit.id);

    // A frame you haven't selected isn't grabbed by a drag: on touch that would
    // make panning across a board impossible. Select it first (tap or its label).
    if (hit && (selected || hit.type !== 'frame')) {
      if (!selected) editor.select(additive ? [...editor.selection, hit.id] : [hit.id]);
      const nodes = editor.topmostSelected().filter(n => !n.locked);
      editor.history.begin('Move');
      return { kind: 'move', nodes, start: new Map(nodes.map(n => [n.id, n.transform])) };
    }
    if (p.touch && !editor.multiSelect) return { kind: 'pan', last: p.screen };
    return { kind: 'marquee', base: additive ? [...editor.selection] : [] };
  }

  // ── Tap ──────────────────────────────────────────────────────

  private tap(stack: Node[], p: PointerInfo): void {
    const { editor } = this.ctx;
    const additive = p.shift || editor.multiSelect;
    // Same spot as the last tap: step down to the next layer under the finger.
    const again = this.lastTap && Math.hypot(p.screen.x - this.lastTap.screen.x, p.screen.y - this.lastTap.screen.y) < 10 && p.time - this.lastTap.time < 1500;
    this.lastTap = { screen: p.screen, time: p.time };

    let pick = stack[0] ?? null;
    if (again && !additive && stack.length > 1) {
      const current = stack.findIndex(n => editor.selection.includes(n.id));
      if (current >= 0) pick = stack[(current + 1) % stack.length]!;
    }
    if (!pick) { if (!additive) editor.select([]); return; }
    if (additive) editor.toggleSelected(pick.id);
    else editor.select([pick.id]);
  }

  // ── Resize and rotate ────────────────────────────────────────

  /** Resize in the node's own space: the opposite edge or corner stays fixed. */
  private resize(m: Extract<Mode, { kind: 'resize' }>, p: PointerInfo): void {
    const { editor } = this.ctx;
    const parentWorld = m.node.parentId ? editor.doc.worldTransform(m.node.parentId) : translation(0, 0);
    const q = apply(invert(multiply(parentWorld, m.t0)), p.world); // pointer in the node's start space
    let x0 = 0, x1 = m.w0, y0 = 0, y1 = m.h0;
    if (m.handle.fx === 0) x0 = q.x;
    if (m.handle.fx === 1) x1 = q.x;
    if (m.handle.fy === 0) y0 = q.y;
    if (m.handle.fy === 1) y1 = q.y;
    if (p.shift && m.handle.fx !== 0.5 && m.handle.fy !== 0.5) {
      // Keep the aspect ratio from the corner handles.
      const s = Math.max(Math.abs(x1 - x0) / m.w0, Math.abs(y1 - y0) / m.h0);
      if (m.handle.fx === 0) x0 = x1 - m.w0 * s; else x1 = x0 + m.w0 * s;
      if (m.handle.fy === 0) y0 = y1 - m.h0 * s; else y1 = y0 + m.h0 * s;
    }
    // Dragging past the opposite edge flips the box instead of going negative.
    const left = Math.min(x0, x1), top = Math.min(y0, y1);
    const width = Math.max(1, Math.abs(x1 - x0)), height = Math.max(1, Math.abs(y1 - y0));
    editor.transact('Resize', () => [
      { t: 'set', id: m.node.id, prop: 'transform', value: multiply(m.t0, translation(left, top)) },
      { t: 'set', id: m.node.id, prop: 'width', value: Math.round(width * 100) / 100 },
      { t: 'set', id: m.node.id, prop: 'height', value: Math.round(height * 100) / 100 },
    ]);
  }

  /** Rotate about the box centre; Shift snaps to 15°. */
  private rotate(m: Extract<Mode, { kind: 'rotate' }>, p: PointerInfo): void {
    const { editor } = this.ctx;
    let delta = Math.atan2(p.world.y - m.centre.y, p.world.x - m.centre.x) - m.a0;
    if (p.shift) {
      const current = Math.atan2(m.t0[1], m.t0[0]);
      delta = Math.round((current + delta) / SNAP_ANGLE) * SNAP_ANGLE - current;
    }
    // Pivot in parent space: T = P⁻¹ · (C · R · C⁻¹) · P · T0, all as world ops.
    const parentWorld = m.node.parentId ? editor.doc.worldTransform(m.node.parentId) : translation(0, 0);
    const pivot = multiply(translation(m.centre.x, m.centre.y), multiply(rotation(delta), translation(-m.centre.x, -m.centre.y)));
    const world = multiply(pivot, multiply(parentWorld, m.t0));
    editor.transact('Rotate', () => [{ t: 'set', id: m.node.id, prop: 'transform', value: multiply(invert(parentWorld), world) }]);
  }
}
