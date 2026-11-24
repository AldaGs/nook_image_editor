// Select tool: tap to select (tap again on the same spot to cycle through
// overlapping layers), drag to move, drag handles to resize or rotate.
// On empty space a finger pans and a mouse draws a marquee; in multi-select
// mode a finger draws a marquee too.

import { apply, invert, multiply, rotation, translation, type Affine, type Point, type Rect } from '../../geom/affine.ts';
import type { Node } from '../../doc/types.ts';
import { localBox, worldBounds } from '../bounds.ts';
import { snapBox, snapEdges } from '../snap.ts';
import { gradientHandles, handleAt, handlesFor, selectionBox, type Handle, type SelectionBox } from '../handles.ts';
import { hitStack, marqueeHits } from '../hit.ts';
import { PointsMode } from './points.ts';
import { dragThreshold, hitRadius, type PointerInfo, type Tool, type ToolContext } from './tool.ts';

type Mode =
  | { kind: 'idle' }
  | { kind: 'press'; hit: Node | null; stack: Node[] }    // down, not yet a drag
  | { kind: 'move'; nodes: Node[]; start: Map<string, Affine>; box: Rect | null; others: Rect[] }
  | { kind: 'resize'; sel: SelectionBox; handle: Handle; others: Rect[] }
  | { kind: 'rotate'; node: Node; t0: Affine; centre: Point; a0: number }
  | { kind: 'gradient'; end: 'from' | 'to' }
  | { kind: 'textSelect'; anchor: number }
  | { kind: 'marquee'; base: string[] }
  | { kind: 'pan'; last: Point }
  | { kind: 'points' };

const SNAP_ANGLE = Math.PI / 12; // 15°

export class SelectTool implements Tool {
  private mode: Mode = { kind: 'idle' };
  private downAt: PointerInfo | null = null;
  private lastTap: { screen: Point; time: number } | null = null;

  private ctx: ToolContext;

  private points: PointsMode;

  constructor(ctx: ToolContext) { this.ctx = ctx; this.points = new PointsMode(ctx); }

  down(p: PointerInfo): void {
    const { editor, camera } = this.ctx;
    this.downAt = p;

    // Typing: a press inside the text moves the caret (a drag selects); anywhere else stops typing.
    const te = editor.textEdit;
    if (te) {
      const tn = editor.doc.get(te.nodeId);
      if (tn && hitStack(editor.doc, editor.pageId, p.world, 0).includes(tn)) {
        const i = this.ctx.textIndexAt(tn.id, p.world);
        editor.setTextSelection(i, i, true);
        this.mode = { kind: 'textSelect', anchor: i };
        return;
      }
      editor.endTextEdit();
    }

    // Editing points: presses on the path edit it; anywhere else stops editing.
    if (editor.pointEdit) {
      if (this.points.down(p)) { this.mode = { kind: 'points' }; return; }
      editor.endPointEdit();
    }

    // While a gradient is being edited, its end points are the only handles.
    const gh = gradientHandles(editor, camera);
    if (gh) {
      const d = (q: Point) => Math.hypot(q.x - p.screen.x, q.y - p.screen.y);
      const end = d(gh.from) <= d(gh.to) ? 'from' : 'to';
      if (d(gh[end]) <= hitRadius(p)) {
        editor.history.begin('Edit gradient');
        this.mode = { kind: 'gradient', end };
        return;
      }
      // A press anywhere else just puts the normal handles back.
      editor.editGradient(null);
      this.mode = { kind: 'idle' };
      this.downAt = null;
      return;
    }

    // Handles win over everything under them.
    const handle = handleAt(handlesFor(editor, camera), p.screen, hitRadius(p));
    const sel = selectionBox(editor);
    if (handle && sel) {
      editor.history.begin(handle.id === 'rotate' ? 'Rotate' : 'Resize');
      const node = sel.node;
      if (handle.id === 'rotate' && node) {
        const box = localBox(editor.doc, node);
        const centre = apply(editor.doc.worldTransform(node.id), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
        this.mode = { kind: 'rotate', node, t0: node.transform, centre, a0: Math.atan2(p.world.y - centre.y, p.world.x - centre.x) };
      } else {
        this.mode = { kind: 'resize', sel, handle, others: this.snapTargets(sel.nodes) };
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

    if (m.kind === 'points') { this.points.move(p); return; }
    if (m.kind === 'press') {
      if (Math.hypot(p.screen.x - start.screen.x, p.screen.y - start.screen.y) < dragThreshold(p)) return;
      this.mode = this.startDrag(m.hit, p);
    }

    const dx = p.world.x - start.world.x, dy = p.world.y - start.world.y;
    const mode = this.mode;
    switch (mode.kind) {
      case 'move': {
        // Snap within 6 screen px; Alt turns it off.
        const snap = mode.box && !p.alt
          ? snapBox({ ...mode.box, x: mode.box.x + dx, y: mode.box.y + dy }, mode.others, 6 / camera.zoom)
          : { dx: 0, dy: 0, guides: [] };
        editor.guides = snap.guides;
        editor.history.rewind();
        editor.transact('Move', () => editor.moveOps(mode.nodes, mode.start, dx + snap.dx, dy + snap.dy));
        break;
      }
      case 'resize':
        editor.history.rewind();
        this.resize(mode, p);
        break;
      case 'rotate':
        editor.history.rewind();
        this.rotate(mode, p);
        break;
      case 'textSelect': {
        const te = editor.textEdit;
        if (!te) break;
        const i = this.ctx.textIndexAt(te.nodeId, p.world);
        editor.setTextSelection(Math.min(mode.anchor, i), Math.max(mode.anchor, i), true);
        break;
      }
      case 'gradient': {
        const t = editor.gradientEdit;
        const g = t && editor.gradientPaint(t);
        const n = t && editor.doc.get(t.nodeId);
        if (!t || !g || !n) break;
        editor.history.rewind();
        // Pointer into the node's unit box.
        const q = apply(invert(editor.doc.worldTransform(n.id)), p.world);
        const u = { x: q.x / (n.width || 1), y: q.y / (n.height || 1) };
        editor.transact('Edit gradient', () => editor.setGradientOps(t, { ...g, [mode.end]: u }));
        break;
      }
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
    if (m.kind === 'points') { this.points.up(); this.mode = { kind: 'idle' }; this.downAt = null; return; }
    if (m.kind === 'press') this.tap(m.stack, p);
    if (m.kind === 'textSelect') { this.mode = { kind: 'idle' }; this.downAt = null; return; }
    if (m.kind === 'move') { editor.guides = []; editor.dropAt(m.nodes, p.world); }
    if (m.kind === 'resize') editor.guides = [];
    if (m.kind === 'move' || m.kind === 'resize' || m.kind === 'rotate' || m.kind === 'gradient') editor.history.commit();
    if (m.kind === 'marquee') { editor.marquee = null; editor.emit(); }
    this.mode = { kind: 'idle' };
    this.downAt = null;
  }

  cancel(): void {
    const { editor } = this.ctx;
    if (this.mode.kind === 'points') this.points.cancel();
    if (this.mode.kind === 'move' || this.mode.kind === 'resize' || this.mode.kind === 'rotate' || this.mode.kind === 'gradient') editor.history.cancel();
    if (this.mode.kind === 'marquee') { editor.marquee = null; editor.emit(); }
    editor.guides = [];
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
      return { kind: 'move', nodes, start: new Map(nodes.map(n => [n.id, n.transform])), box: worldBounds(editor.doc, nodes), others: this.snapTargets(nodes) };
    }
    if (p.touch && !editor.multiSelect) return { kind: 'pan', last: p.screen };
    return { kind: 'marquee', base: additive ? [...editor.selection] : [] };
  }

  /** Boxes a move can snap to: boards and what's on the page or directly in a board, minus what's moving. */
  private snapTargets(moving: Node[]): Rect[] {
    return this.ctx.editor.snapRects(moving.map(n => n.id));
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
    // A tap on the path that is already the only selection edits its points.
    if (!additive && pick.type === 'vector' && editor.selection.length === 1 && editor.selection[0] === pick.id) {
      editor.editPoints(pick.id);
      return;
    }
    // A tap on the text layer that is already the only selection starts typing there.
    if (!additive && pick.type === 'text' && editor.selection.length === 1 && editor.selection[0] === pick.id) {
      const i = this.ctx.textIndexAt(pick.id, p.world);
      editor.startTextEdit(pick.id, i, i);
      return;
    }
    if (additive) editor.toggleSelected(pick.id);
    else editor.select([pick.id]);
  }

  // ── Resize and rotate ────────────────────────────────────────

  /** Resize in the selection box's own space: the opposite edge or corner stays fixed. */
  private resize(m: Extract<Mode, { kind: 'resize' }>, p: PointerInfo): void {
    const { editor } = this.ctx;
    const { toWorld, box, nodes } = m.sel;
    const q = apply(invert(toWorld), p.world); // pointer in box space
    let x0 = box.x, x1 = box.x + box.width, y0 = box.y, y1 = box.y + box.height;
    if (m.handle.fx === 0) x0 = q.x;
    if (m.handle.fx === 1) x1 = q.x;
    if (m.handle.fy === 0) y0 = q.y;
    if (m.handle.fy === 1) y1 = q.y;
    if (p.shift && m.handle.fx !== 0.5 && m.handle.fy !== 0.5) {
      // Keep the aspect ratio from the corner handles.
      const s = Math.max(Math.abs(x1 - x0) / box.width, Math.abs(y1 - y0) / box.height);
      if (m.handle.fx === 0) x0 = x1 - box.width * s; else x1 = x0 + box.width * s;
      if (m.handle.fy === 0) y0 = y1 - box.height * s; else y1 = y0 + box.height * s;
    }
    // Smart guides: snap the dragged edges, in world space, while the box isn't rotated
    // (Alt or Shift-for-aspect turns it off).
    editor.guides = [];
    const [a, b, c, d, e, f] = toWorld;
    if (!p.alt && !p.shift && Math.abs(b) < 1e-9 && Math.abs(c) < 1e-9 && a > 0 && d > 0) {
      const side = (fx: number, v0: number, v1: number) => (fx === 0.5 ? undefined : (fx === 0) === (v0 <= v1) ? 'lo' : 'hi');
      const wx0 = Math.min(x0, x1), wy0 = Math.min(y0, y1);
      const world = { x: a * wx0 + e, y: d * wy0 + f, width: a * Math.abs(x1 - x0), height: d * Math.abs(y1 - y0) };
      const snap = snapEdges(world, { x: side(m.handle.fx, x0, x1), y: side(m.handle.fy, y0, y1) }, m.others, 6 / this.ctx.camera.zoom);
      editor.guides = snap.guides;
      // Back to box space, keeping which side is which.
      const bx0 = (snap.box.x - e) / a, bx1 = bx0 + snap.box.width / a;
      const by0 = (snap.box.y - f) / d, by1 = by0 + snap.box.height / d;
      if (x0 <= x1) { x0 = bx0; x1 = bx1; } else { x1 = bx0; x0 = bx1; }
      if (y0 <= y1) { y0 = by0; y1 = by1; } else { y1 = by0; y0 = by1; }
    }
    // Dragging past the opposite edge flips the box instead of going negative.
    const to = { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.max(1, Math.abs(x1 - x0)), height: Math.max(1, Math.abs(y1 - y0)) };
    editor.transact('Resize', () => editor.scaleOps(nodes, toWorld, box, to));
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
