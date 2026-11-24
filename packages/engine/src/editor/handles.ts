// Selection handles, in screen space so they stay the same size at any zoom.
// Single selection: 8 resize handles + a rotate handle above the top edge.
// Groups get no resize handles (scaling children comes with constraints later);
// frames get no rotate handle (a comp can't be rotated in PBC or AE).

import type { Camera } from '../camera/camera.ts';
import type { Point } from '../geom/affine.ts';
import type { Editor } from './editor.ts';
import { worldCorners } from './bounds.ts';

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

export interface Handle {
  id: HandleId;
  screen: Point;
  /** Position on the node's box, 0–1 on each axis (unused for rotate). */
  fx: number;
  fy: number;
}

/** Distance of the rotate handle above the top edge, in CSS px. */
export const ROTATE_OFFSET = 28;

const RESIZE: [HandleId, number, number][] = [
  ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['e', 1, 0.5],
  ['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1], ['w', 0, 0.5],
];

/** Screen corners of the single selected node, or null. */
export function selectionQuad(editor: Editor, camera: Camera): Point[] | null {
  const [only, ...rest] = editor.selectedNodes();
  if (!only || rest.length) return null;
  return worldCorners(editor.doc, only).map(p => camera.worldToScreen(p));
}

export function handlesFor(editor: Editor, camera: Camera): Handle[] {
  const node = editor.selectedNodes()[0];
  const quad = selectionQuad(editor, camera);
  if (!node || !quad || node.locked) return [];
  const [tl, tr, , bl] = quad as [Point, Point, Point, Point];
  // Bilinear point on the (possibly rotated) box.
  const at = (fx: number, fy: number): Point => ({
    x: tl.x + (tr.x - tl.x) * fx + (bl.x - tl.x) * fy,
    y: tl.y + (tr.y - tl.y) * fx + (bl.y - tl.y) * fy,
  });
  const out: Handle[] = [];
  if (node.type !== 'group') {
    // Skip edge handles on boxes too small on screen to tell them apart.
    const small = Math.hypot(tr.x - tl.x, tr.y - tl.y) < 40 || Math.hypot(bl.x - tl.x, bl.y - tl.y) < 40;
    for (const [id, fx, fy] of RESIZE) {
      if (small && (fx === 0.5 || fy === 0.5)) continue;
      out.push({ id, screen: at(fx, fy), fx, fy });
    }
  }
  if (node.type !== 'frame') {
    // Up from the top edge's midpoint, along the box's own "up".
    const top = at(0.5, 0);
    const up = { x: tl.x - bl.x, y: tl.y - bl.y };
    const len = Math.hypot(up.x, up.y) || 1;
    out.push({ id: 'rotate', screen: { x: top.x + (up.x / len) * ROTATE_OFFSET, y: top.y + (up.y / len) * ROTATE_OFFSET }, fx: 0.5, fy: 0 });
  }
  return out;
}

/** The handle within `radius` CSS px of a screen point, nearest first. */
export function handleAt(handles: Handle[], p: Point, radius: number): Handle | null {
  let best: Handle | null = null, bestD = radius;
  for (const h of handles) {
    const d = Math.hypot(h.screen.x - p.x, h.screen.y - p.y);
    if (d <= bestD) { best = h; bestD = d; }
  }
  return best;
}
