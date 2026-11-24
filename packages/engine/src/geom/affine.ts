// 2D affine matrices as [a, b, c, d, tx, ty]:
//   x' = a·x + c·y + tx
//   y' = b·x + d·y + ty
// This is the README's node `transform` layout (same as DOMMatrix a–f).

export type Affine = [number, number, number, number, number, number];
export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

export const identity = (): Affine => [1, 0, 0, 1, 0, 0];
export const translation = (x: number, y: number): Affine => [1, 0, 0, 1, x, y];
export const rotation = (rad: number): Affine => {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
};

/** m × n: applies n first, then m. */
export function multiply(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Affine): Affine {
  const [a, b, c, d, tx, ty] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return identity(); // degenerate (zero size): avoid NaN
  return [d / det, -b / det, -c / det, a / det, (c * ty - d * tx) / det, (b * tx - a * ty) / det];
}

export function apply(m: Affine, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Apply only the linear part (for direction vectors like drag deltas). */
export function applyVector(m: Affine, v: Point): Point {
  return { x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y };
}

/** In-plane rotation of the matrix, in radians. */
export const angleOf = (m: Affine): number => Math.atan2(m[1], m[0]);

/** Scale along the matrix's own x and y axes (y is negative when flipped). */
export function scaleOf(m: Affine): { sx: number; sy: number } {
  const sx = Math.hypot(m[0], m[1]);
  return { sx, sy: sx ? (m[0] * m[3] - m[1] * m[2]) / sx : 0 };
}

/** The four corners of a local rect, transformed (clockwise from top-left). */
export function corners(m: Affine, r: Rect): Point[] {
  return [
    apply(m, { x: r.x, y: r.y }),
    apply(m, { x: r.x + r.width, y: r.y }),
    apply(m, { x: r.x + r.width, y: r.y + r.height }),
    apply(m, { x: r.x, y: r.y + r.height }),
  ];
}

/** Axis-aligned bounds of a set of points. */
export function boundsOf(points: Point[]): Rect | null {
  if (!points.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
