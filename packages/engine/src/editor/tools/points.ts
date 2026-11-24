// Point editing, inside the select tool while `editor.pointEdit` is set.
// Points win over everything (44 px touch targets), then the selected point's
// handles, then the path itself: a tap on it adds a point there without
// changing the curve. A press anywhere else ends point editing.

import { apply, invert, type Point } from '../../geom/affine.ts';
import { bezierAt, segments, type Anchor, type VectorPath } from '../../doc/shapes.ts';
import type { Node } from '../../doc/types.ts';
import { dragThreshold, type PointerInfo, type ToolContext } from './tool.ts';

/** Touch target radius for points and handles, CSS px (44 px across on touch). */
const pointRadius = (p: PointerInfo) => (p.touch ? 22 : 8);

type Drag =
  | { kind: 'anchor'; index: number; start: VectorPath }
  | { kind: 'handle'; index: number; side: 'in' | 'out'; start: VectorPath }
  | { kind: 'segment'; at: Point };

export class PointsMode {
  private ctx: ToolContext;
  private drag: Drag | null = null;
  private downAt: PointerInfo | null = null;
  private moved = false;

  constructor(ctx: ToolContext) { this.ctx = ctx; }

  private node(): Node | null {
    const pe = this.ctx.editor.pointEdit;
    const n = pe ? this.ctx.editor.doc.get(pe.nodeId) : undefined;
    return n?.type === 'vector' && n.path ? n : null;
  }

  /** Handle a press; false when it isn't on the path (the caller ends point editing). */
  down(p: PointerInfo): boolean {
    const { editor, camera } = this.ctx;
    const n = this.node();
    if (!n) return false;
    const path = n.path!;
    const m = editor.doc.worldTransform(n.id);
    const scr = (q: Point) => camera.worldToScreen(apply(m, q));
    const near = (q: Point) => Math.hypot(q.x - p.screen.x, q.y - p.screen.y);
    const r = pointRadius(p);
    this.downAt = p;
    this.moved = false;

    // Points first, nearest wins.
    let best = -1, bestD = r;
    path.anchors.forEach((a, i) => { const d = near(scr(a.p)); if (d <= bestD) { best = i; bestD = d; } });
    if (best >= 0) {
      editor.selectPoint(best);
      editor.history.begin('Move point');
      this.drag = { kind: 'anchor', index: best, start: path };
      return true;
    }
    // Then the selected point's handles.
    const sel = editor.pointEdit!.anchor;
    const a = sel !== null ? path.anchors[sel] : undefined;
    if (a && sel !== null) {
      for (const side of ['in', 'out'] as const) {
        const t = a[side];
        if ((t.x || t.y) && near(scr({ x: a.p.x + t.x, y: a.p.y + t.y })) <= r) {
          editor.history.begin('Move handle');
          this.drag = { kind: 'handle', index: sel, side, start: path };
          return true;
        }
      }
    }
    // Then the path: a tap adds a point there.
    const q = apply(invert(m), p.world);
    if (nearestOnPath(path, q).dist * camera.zoom <= r) {
      this.drag = { kind: 'segment', at: q };
      return true;
    }
    return false;
  }

  move(p: PointerInfo): void {
    const { editor } = this.ctx;
    const d = this.drag, s = this.downAt, n = this.node();
    if (!d || !s || !n) return;
    if (!this.moved && Math.hypot(p.screen.x - s.screen.x, p.screen.y - s.screen.y) < dragThreshold(p)) return;
    this.moved = true;
    if (d.kind === 'segment') return;
    const inv = invert(editor.doc.worldTransform(n.id));
    const q = apply(inv, p.world), q0 = apply(inv, s.world);
    const anchors = d.start.anchors.map(a => ({ ...a }));
    const a = anchors[d.index]!;
    if (d.kind === 'anchor') {
      // Snap the point's world position; the other points of the path count as targets.
      const m0 = editor.doc.worldTransform(n.id);
      const start = d.start.anchors[d.index]!.p;
      const raw = apply(m0, { x: start.x + q.x - q0.x, y: start.y + q.y - q0.y });
      const others = d.start.anchors.filter((_, j) => j !== d.index).map(o => apply(m0, o.p));
      const w = editor.snapWorldPoint(raw, { zoom: this.ctx.camera.zoom, touch: p.touch, alt: p.alt, skip: [n.id], extra: others });
      a.p = apply(inv, w);
    } else {
      const t = { x: q.x - a.p.x, y: q.y - a.p.y };
      const other = d.side === 'in' ? 'out' : 'in';
      a[d.side] = t;
      if (!a.split) a[other] = { x: -t.x, y: -t.y }; // smooth points mirror
    }
    editor.history.rewind();
    // Positions are relative to the path's box, which refits after every change: work from the start state.
    editor.transact('Edit path', () => editor.pathOps(n, { ...d.start, anchors }));
  }

  up(): void {
    const { editor } = this.ctx;
    editor.guides = [];
    const d = this.drag, n = this.node();
    this.drag = null;
    this.downAt = null;
    if (!d) return;
    if (d.kind === 'segment') {
      if (!this.moved && n) editor.insertPoint(n, nearestOnPath(n.path!, d.at));
      return;
    }
    editor.history.commit();
  }

  cancel(): void {
    this.ctx.editor.guides = [];
    if (this.drag && this.drag.kind !== 'segment') this.ctx.editor.history.cancel();
    this.drag = null;
    this.downAt = null;
  }
}

/** The closest point on a path to `q`: segment index, curve parameter and distance (local units). */
export function nearestOnPath(path: VectorPath, q: Point): { seg: number; t: number; dist: number } {
  let best = { seg: -1, t: 0, dist: Infinity };
  segments(path).forEach((s, seg) => {
    for (let i = 0; i <= 64; i++) {
      const t = i / 64, b = bezierAt(s, t), dist = Math.hypot(b.x - q.x, b.y - q.y);
      if (dist < best.dist) best = { seg, t, dist };
    }
  });
  return best;
}

/** Split segment `seg` at `t` (de Casteljau), so the curve keeps its shape. */
export function splitAt(path: VectorPath, seg: number, t: number): { path: VectorPath; index: number } {
  const s = segments(path)[seg]!;
  const lerp = (a: Point, b: Point) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const [p0, c1, c2, p3] = s;
  const a1 = lerp(p0, c1), a2 = lerp(c1, c2), a3 = lerp(c2, p3);
  const b1 = lerp(a1, a2), b2 = lerp(a2, a3), mid = lerp(b1, b2);
  const anchors: Anchor[] = path.anchors.map(a => ({ ...a }));
  const i0 = seg, i1 = (seg + 1) % anchors.length;
  const rel = (h: Point, o: Point) => ({ x: h.x - o.x, y: h.y - o.y });
  anchors[i0] = { ...anchors[i0]!, out: rel(a1, p0) };
  anchors[i1] = { ...anchors[i1]!, in: rel(a3, p3) };
  const straight = c1.x === p0.x && c1.y === p0.y && c2.x === p3.x && c2.y === p3.y;
  const added: Anchor = straight
    ? { p: mid, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } }
    : { p: mid, in: rel(b1, mid), out: rel(b2, mid) };
  if (straight) { anchors[i0]!.out = { x: 0, y: 0 }; anchors[i1]!.in = { x: 0, y: 0 }; }
  anchors.splice(seg + 1, 0, added);
  return { path: { ...path, anchors }, index: seg + 1 };
}
