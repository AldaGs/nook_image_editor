// Shapes drawn as paths (polygon, star, line) and the path model that vectors
// (stage 6) share. Tangents are relative to their anchor, as in After Effects
// and PBC, so a corner has both at (0, 0).

import type { Point } from '../geom/affine.ts';
import type { Node } from './types.ts';

/** `split`: the two handles move on their own (otherwise dragging one mirrors the other). */
export interface Anchor { p: Point; in: Point; out: Point; split?: boolean }
export interface VectorPath { anchors: Anchor[]; closed: boolean }

const corner = (x: number, y: number): Anchor => ({ p: { x, y }, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } });

/** Points round the ellipse in a w×h box, first one at the top, clockwise. */
function ring(w: number, h: number, n: number, radius: (i: number) => number): Anchor[] {
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n, r = radius(i);
    return corner(w / 2 + (w / 2) * r * Math.cos(a), h / 2 + (h / 2) * r * Math.sin(a));
  });
}

/** The node's outline as a path, for the types drawn as one; null for the rest. */
export function shapePath(n: Node): VectorPath | null {
  switch (n.type) {
    case 'polygon':
      return { anchors: ring(n.width, n.height, Math.max(3, n.pointCount ?? 3), () => 1), closed: true };
    case 'star': {
      const inner = n.innerRatio ?? 0.4;
      return { anchors: ring(n.width, n.height, Math.max(3, n.pointCount ?? 5) * 2, i => (i % 2 ? inner : 1)), closed: true };
    }
    case 'line':
      return { anchors: [corner(0, 0), corner(n.width, 0)], closed: false };
    case 'vector':
      return n.path ?? null;
    default:
      return null;
  }
}

/** Every contour of the node's shape: a vector's path and its subpaths, or the one path of a polygon, star or line. */
export function contoursOf(n: Node): VectorPath[] {
  if (n.type === 'vector') return [n.path, ...(n.subpaths ?? [])].filter((p): p is VectorPath => !!p && p.anchors.length > 0);
  const p = shapePath(n);
  return p ? [p] : [];
}

/** Bounds of several contours together. */
export function contoursBounds(paths: VectorPath[]): { x: number; y: number; width: number; height: number } {
  const pts = paths.flatMap(flatten);
  if (!pts.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Inside a shape made of several contours: an odd number of closed contours contain the point (holes), or near any outline. */
export function contoursContain(paths: VectorPath[], q: Point, slop: number): boolean {
  let count = 0;
  for (const p of paths) {
    if (pathContains({ ...p, closed: false }, q, slop)) return true;
    if (p.closed && pathContains(p, q, 0)) count++;
  }
  return count % 2 === 1;
}

/**
 * Contours from Skia path commands (CanvasKit's toCmds: verb, then points).
 * Quads become cubics exactly; conics (ellipse arcs) become the usual cubic
 * approximation. A contour that returns to its start drops the duplicate point.
 */
export function contoursFromCmds(cmds: ArrayLike<number>, verbs: { move: number; line: number; quad: number; conic: number; cubic: number; close: number }): VectorPath[] {
  const out: VectorPath[] = [];
  let cur: Anchor[] | null = null;
  const zero = () => ({ x: 0, y: 0 });
  const end = (closed: boolean) => {
    if (!cur || !cur.length) { cur = null; return; }
    const first = cur[0]!, last = cur[cur.length - 1]!;
    if (cur.length > 1 && Math.hypot(first.p.x - last.p.x, first.p.y - last.p.y) < 1e-6) {
      first.in = last.in;
      cur.pop();
      closed = true;
    }
    out.push({ anchors: cur, closed });
    cur = null;
  };
  const cubicTo = (c1: Point, c2: Point, p: Point) => {
    const prev = cur![cur!.length - 1]!;
    prev.out = { x: c1.x - prev.p.x, y: c1.y - prev.p.y };
    cur!.push({ p, in: { x: c2.x - p.x, y: c2.y - p.y }, out: zero() });
  };
  for (let i = 0; i < cmds.length;) {
    const v = cmds[i++]!;
    const pt = () => { const p = { x: cmds[i]!, y: cmds[i + 1]! }; i += 2; return p; };
    if (v === verbs.move) { end(false); cur = [{ p: pt(), in: zero(), out: zero() }]; }
    else if (v === verbs.line) cur!.push({ p: pt(), in: zero(), out: zero() });
    else if (v === verbs.quad || v === verbs.conic) {
      const p0 = cur![cur!.length - 1]!.p, c = pt(), p = pt();
      const w = v === verbs.conic ? cmds[i++]! : 1;
      const k = (4 * w) / (3 * (1 + w)); // 2/3 for a quad
      cubicTo({ x: p0.x + (c.x - p0.x) * k, y: p0.y + (c.y - p0.y) * k }, { x: p.x + (c.x - p.x) * k, y: p.y + (c.y - p.y) * k }, p);
    } else if (v === verbs.cubic) { const c1 = pt(), c2 = pt(); cubicTo(c1, c2, pt()); }
    else if (v === verbs.close) end(true);
  }
  end(false);
  return out;
}

/** The cubic segments, in order: [p0, c1, c2, p3]. A closed path includes the one back to the start. */
export function segments(path: VectorPath): [Point, Point, Point, Point][] {
  const a = path.anchors, out: [Point, Point, Point, Point][] = [];
  const n = path.closed ? a.length : a.length - 1;
  for (let i = 0; i < n; i++) {
    const s = a[i]!, e = a[(i + 1) % a.length]!;
    out.push([s.p, { x: s.p.x + s.out.x, y: s.p.y + s.out.y }, { x: e.p.x + e.in.x, y: e.p.y + e.in.y }, e.p]);
  }
  return out;
}

export function bezierAt([p0, c1, c2, p3]: [Point, Point, Point, Point], t: number): Point {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * c1.x + c * c2.x + d * p3.x, y: a * p0.y + b * c1.y + c * c2.y + d * p3.y };
}

const isLine = ([p0, c1, c2, p3]: [Point, Point, Point, Point]) => c1.x === p0.x && c1.y === p0.y && c2.x === p3.x && c2.y === p3.y;

/** The path as a polyline: straight segments as they are, curves in 24 steps. */
export function flatten(path: VectorPath): Point[] {
  const segs = segments(path);
  if (!segs.length) return path.anchors.map(a => a.p);
  const out: Point[] = [segs[0]![0]];
  for (const s of segs) {
    if (isLine(s)) out.push(s[3]);
    else for (let i = 1; i <= 24; i++) out.push(bezierAt(s, i / 24));
  }
  return out;
}

const points = (path: VectorPath): Point[] => flatten(path);

/** Bounds of the drawn curve (not its handles). */
export function pathBounds(path: VectorPath): { x: number; y: number; width: number; height: number } {
  const pts = flatten(path);
  if (!pts.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Move a path by (dx, dy). */
export const shiftPath = (path: VectorPath, dx: number, dy: number): VectorPath =>
  ({ ...path, anchors: path.anchors.map(a => ({ ...a, p: { x: a.p.x + dx, y: a.p.y + dy } })) });

/** Scale a path (points and handles) about its origin. */
export const scalePath = (path: VectorPath, sx: number, sy: number): VectorPath => ({
  ...path,
  anchors: path.anchors.map(a => ({ p: { x: a.p.x * sx, y: a.p.y * sy }, in: { x: a.in.x * sx, y: a.in.y * sy }, out: { x: a.out.x * sx, y: a.out.y * sy } })),
});

/** Is a local point inside a closed path (even-odd), or within `slop` of an open one? */
export function pathContains(path: VectorPath, q: Point, slop: number): boolean {
  const pts = points(path);
  if (path.closed) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i]!, b = pts[j]!;
      if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    if (inside) return true;
  }
  for (let i = 0; i + 1 < pts.length; i++) if (distToSegment(q, pts[i]!, pts[i + 1]!) <= slop) return true;
  return false;
}

function distToSegment(q: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len)) : 0;
  return Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy));
}
