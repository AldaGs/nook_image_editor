// Snapping: pull a moving box so its left/centre/right and top/middle/bottom
// line up with another box's, and report the guide lines to draw.

import type { Point, Rect } from '../geom/affine.ts';

/** A guide line in world space. */
export interface Guide { a: Point; b: Point }

const stops = (r: Rect, axis: 'x' | 'y') =>
  axis === 'x' ? [r.x, r.x + r.width / 2, r.x + r.width] : [r.y, r.y + r.height / 2, r.y + r.height];

/** Best offset along one axis within `tol`, and the boxes it lines up with. */
function snapAxis(box: Rect, others: Rect[], axis: 'x' | 'y', tol: number) {
  let best = tol, delta = 0, line: number | null = null;
  for (const o of others) {
    for (const s of stops(box, axis)) {
      for (const t of stops(o, axis)) {
        if (Math.abs(t - s) < best) { best = Math.abs(t - s); delta = t - s; line = t; }
      }
    }
  }
  return { delta, line };
}

/**
 * Snap `box` (already moved by the raw drag) to `others`. Returns the extra
 * offset to apply and guides spanning the moved box and what it lines up with.
 */
export function snapBox(box: Rect, others: Rect[], tol: number): { dx: number; dy: number; guides: Guide[] } {
  const sx = snapAxis(box, others, 'x', tol);
  const sy = snapAxis(box, others, 'y', tol);
  const moved = { ...box, x: box.x + sx.delta, y: box.y + sy.delta };
  const guides: Guide[] = [];
  const span = (axis: 'x' | 'y', at: number) => {
    // Everything touching the line, plus the moved box, sets its extent.
    const hit = [moved, ...others.filter(o => stops(o, axis).some(t => Math.abs(t - at) < 1e-6))];
    if (axis === 'x') guides.push({ a: { x: at, y: Math.min(...hit.map(r => r.y)) }, b: { x: at, y: Math.max(...hit.map(r => r.y + r.height)) } });
    else guides.push({ a: { x: Math.min(...hit.map(r => r.x)), y: at }, b: { x: Math.max(...hit.map(r => r.x + r.width)), y: at } });
  };
  if (sx.line !== null) span('x', sx.line);
  if (sy.line !== null) span('y', sy.line);
  return { dx: sx.delta, dy: sy.delta, guides };
}
