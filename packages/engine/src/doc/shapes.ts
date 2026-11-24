// Shapes drawn as paths (polygon, star, line) and the path model that vectors
// (stage 6) share. Tangents are relative to their anchor, as in After Effects
// and PBC, so a corner has both at (0, 0).

import type { Point } from '../geom/affine.ts';
import type { Node } from './types.ts';

export interface Anchor { p: Point; in: Point; out: Point }
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
    default:
      return null;
  }
}

/** Straight-line approximation of a path (curves by their end points; ponytail: flatten Béziers when vectors get curves). */
const points = (path: VectorPath): Point[] => path.anchors.map(a => a.p);

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
  const segs = path.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segs; i++) if (distToSegment(q, pts[i]!, pts[(i + 1) % pts.length]!) <= slop) return true;
  return false;
}

function distToSegment(q: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len)) : 0;
  return Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy));
}
