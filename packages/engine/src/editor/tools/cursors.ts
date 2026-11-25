// Mouse cursors for the canvas. Pen and rotate are drawn here (CSS has none);
// resize picks the CSS arrow nearest the handle's on-screen direction, so a
// rotated box still gets arrows that point the way the edge moves.

import type { Point } from '../../geom/affine.ts';

const svg = (body: string, x: number, y: number, fallback: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>${body}</svg>`)}") ${x} ${y}, ${fallback}`;

export const PEN_CURSOR = svg(
  `<path d='M3 3l5 14 3-6 6-3z' fill='#fff' stroke='#000' stroke-width='1.3' stroke-linejoin='round'/><circle cx='9.5' cy='9.5' r='1.4'/>`,
  3, 3, 'crosshair');
/** The pen over the path's first point: a click closes the shape. */
export const PEN_CLOSE_CURSOR = svg(
  `<path d='M3 3l5 14 3-6 6-3z' fill='#fff' stroke='#000' stroke-width='1.3' stroke-linejoin='round'/><circle cx='18' cy='18' r='3' fill='#fff' stroke='#000' stroke-width='1.3'/>`,
  3, 3, 'crosshair');
export const ROTATE_CURSOR = svg(
  `<g fill='none' stroke-linecap='round'><path d='M6 15a7 7 0 1 1 6 4' stroke='#fff' stroke-width='4'/><path d='M6 15a7 7 0 1 1 6 4' stroke='#000' stroke-width='1.6'/></g><path d='M2.5 12.5l3.5 4 3.5-4z' stroke='#fff' stroke-width='1'/>`,
  12, 12, 'grab');

const RESIZE = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
/** The resize arrow for a handle at `at` on a box centred at `centre` (screen space). */
export function resizeCursor(centre: Point, at: Point): string {
  const a = Math.atan2(at.y - centre.y, at.x - centre.x); // screen y points down
  const i = ((Math.round(a / (Math.PI / 4)) % 4) + 4) % 4;
  return RESIZE[i]!;
}
