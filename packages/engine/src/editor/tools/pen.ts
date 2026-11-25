// Pen tool, touch first. Tap places a corner point; press and drag pulls out a
// smooth point's handle (the other side mirrors it). Tapping the first point
// closes the path. Each point is one undo step, and a two-finger pinch only
// cancels the point being placed, so the path survives moving the view.
// A loupe above the finger shows where the point lands (the renderer draws it).

import { apply, invert, translation, type Point } from '../../geom/affine.ts';
import { createNode, newId } from '../../doc/factory.ts';
import type { Anchor } from '../../doc/shapes.ts';
import { localFor } from '../bounds.ts';
import { frameAt } from '../hit.ts';
import { PEN_CLOSE_CURSOR, PEN_CURSOR } from './cursors.ts';
import { dragThreshold, hitRadius, type PointerInfo, type Tool, type ToolContext } from './tool.ts';

export class PenTool implements Tool {
  private ctx: ToolContext;
  private start: PointerInfo | null = null;
  private dragging = false;
  private closing = false;

  constructor(ctx: ToolContext) { this.ctx = ctx; }

  /** The pointer with its world point snapped to the path's points and nearby boxes. */
  private snapped(p: PointerInfo): PointerInfo {
    const { editor, camera } = this.ctx;
    const n = editor.penNode();
    const m = n && editor.doc.worldTransform(n.id);
    const own = n?.path && m ? n.path.anchors.map(a => apply(m, a.p)) : [];
    return { ...p, world: editor.snapWorldPoint(p.world, { zoom: camera.zoom, touch: p.touch, alt: p.alt, skip: n ? [n.id] : [], extra: own }) };
  }

  cursor(p: PointerInfo): string {
    if (this.start && this.dragging) return 'move';
    const { editor, camera } = this.ctx;
    const n = editor.penNode();
    const first = n?.path && n.path.anchors.length >= 2 ? n.path.anchors[0] : undefined;
    return n && first && dist(camera.worldToScreen(apply(editor.doc.worldTransform(n.id), first.p)), p.screen) <= hitRadius(p) * 1.5
      ? PEN_CLOSE_CURSOR : PEN_CURSOR;
  }

  down(raw: PointerInfo): void {
    const { editor, camera } = this.ctx;
    const p = this.snapped(raw);
    this.start = p;
    this.dragging = false;
    const n = editor.penNode();
    const first = n?.path?.anchors[0];
    // Tapping the first point (once there's a segment to close) closes the path.
    this.closing = !!(n && first && n.path!.anchors.length >= 2 &&
      dist(camera.worldToScreen(apply(editor.doc.worldTransform(n.id), first.p)), p.screen) <= hitRadius(p) * 1.5);
    if (this.closing) return;
    editor.history.begin('Add point');
    this.place(p.world, null);
    if (p.touch) editor.pen.loupe = p.screen;
    this.ctx.invalidate();
  }

  move(p: PointerInfo): void {
    const s = this.start;
    if (!s || this.closing) return;
    const { editor } = this.ctx;
    if (p.touch) editor.pen.loupe = p.screen;
    if (!this.dragging && dist(p.screen, s.screen) < dragThreshold(p)) { this.ctx.invalidate(); return; }
    this.dragging = true;
    editor.guides = []; // the point is placed; the drag only pulls its handle
    editor.history.rewind();
    this.place(s.world, p.world);
  }

  up(raw: PointerInfo): void {
    const { editor } = this.ctx;
    if (!this.start) return;
    const p = this.dragging ? raw : this.snapped(raw);
    this.start = null;
    editor.pen.loupe = null;
    editor.guides = [];
    if (this.closing) { editor.finishPen(true); editor.setTool('select'); return; }
    if (!this.dragging) { editor.history.rewind(); this.place(p.world, null); }
    editor.history.commit();
    editor.emit();
  }

  cancel(): void {
    const { editor } = this.ctx;
    editor.guides = [];
    if (this.start && !this.closing) editor.history.cancel();
    this.start = null;
    editor.pen.loupe = null;
    editor.emit();
  }

  /**
   * Add a point at `at` (world), as a corner or, with `handle`, smooth with its
   * out handle reaching to `handle`. The first point creates the path layer.
   */
  private place(at: Point, handle: Point | null): void {
    const { editor } = this.ctx;
    const n = editor.penNode();
    if (!n) {
      const parentId = frameAt(editor.doc, editor.pageId, at)?.id ?? editor.pageId;
      const node = createNode('vector', {
        id: newId(),
        name: 'Path',
        parentId,
        order: editor.orderAtTop(parentId),
        transform: localFor(editor.doc, translation(at.x, at.y), parentId),
        width: 0,
        height: 0,
        path: { anchors: [anchor({ x: 0, y: 0 }, handle && { x: handle.x - at.x, y: handle.y - at.y })], closed: false },
      });
      editor.transact('Add point', () => [{ t: 'add', node }]);
      editor.pen.nodeId = node.id;
      return;
    }
    // Into the path's own space (a vector keeps an unscaled transform, so vectors carry over by the same inverse).
    const inv = invert(editor.doc.worldTransform(n.id));
    const q = apply(inv, at);
    const h = handle && apply(inv, handle);
    const a = anchor(q, h && { x: h.x - q.x, y: h.y - q.y });
    editor.transact('Add point', () => editor.pathOps(n, { ...n.path!, anchors: [...n.path!.anchors, a] }));
  }
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** A corner, or a smooth point whose in handle mirrors its out handle. */
function anchor(p: Point, out: Point | null): Anchor {
  return out ? { p, out, in: { x: -out.x, y: -out.y } } : { p, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } };
}
