// Selection handles, in screen space so they stay the same size at any zoom.
// One node or group: 8 resize handles + a rotate handle above the top edge,
// on its own (possibly rotated) box. Several nodes: resize handles on the box
// around them all. Frames get no rotate handle (a comp can't be rotated in PBC or AE).

import type { Camera } from '../camera/camera.ts';
import { apply, corners, identity, type Affine, type Point, type Rect } from '../geom/affine.ts';
import type { Node } from '../doc/types.ts';
import type { Editor } from './editor.ts';
import { localBox, worldBounds } from './bounds.ts';

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

/** The box handles sit on: `box` in the space `toWorld` maps to world. `node` is set for a single selection. */
export interface SelectionBox { toWorld: Affine; box: Rect; node: Node | null; nodes: Node[] }

export function selectionBox(editor: Editor): SelectionBox | null {
  const nodes = editor.topmostSelected().filter(n => !n.locked);
  if (!nodes.length || nodes.length < editor.topmostSelected().length) return null;
  if (nodes.length === 1) {
    const node = nodes[0]!;
    return { toWorld: editor.doc.worldTransform(node.id), box: localBox(editor.doc, node), node, nodes };
  }
  const box = worldBounds(editor.doc, nodes);
  return box && { toWorld: identity(), box, node: null, nodes };
}

/** Screen corners of the selection box, or null. */
export function selectionQuad(editor: Editor, camera: Camera): Point[] | null {
  const sel = selectionBox(editor);
  return sel && corners(sel.toWorld, sel.box).map(p => camera.worldToScreen(p));
}

/** Screen positions of the edited gradient's end points, or null. */
export function gradientHandles(editor: Editor, camera: Camera): { from: Point; to: Point } | null {
  const t = editor.gradientEdit;
  const g = t && editor.gradientPaint(t);
  const n = t && editor.doc.get(t.nodeId);
  if (!g || !n) return null;
  const m = editor.doc.worldTransform(n.id);
  const at = (u: Point) => camera.worldToScreen(apply(m, { x: u.x * n.width, y: u.y * n.height }));
  return { from: at(g.from), to: at(g.to) };
}

export function handlesFor(editor: Editor, camera: Camera): Handle[] {
  if (editor.gradientEdit) return []; // the gradient's own handles are showing instead
  const sel = selectionBox(editor);
  const quad = selectionQuad(editor, camera);
  if (!sel || !quad) return [];
  const [tl, tr, , bl] = quad as [Point, Point, Point, Point];
  // Bilinear point on the (possibly rotated) box.
  const at = (fx: number, fy: number): Point => ({
    x: tl.x + (tr.x - tl.x) * fx + (bl.x - tl.x) * fy,
    y: tl.y + (tr.y - tl.y) * fx + (bl.y - tl.y) * fy,
  });
  const out: Handle[] = [];
  // Skip edge handles on boxes too small on screen to tell them apart.
  const small = Math.hypot(tr.x - tl.x, tr.y - tl.y) < 40 || Math.hypot(bl.x - tl.x, bl.y - tl.y) < 40;
  for (const [id, fx, fy] of RESIZE) {
    if (small && (fx === 0.5 || fy === 0.5)) continue;
    out.push({ id, screen: at(fx, fy), fx, fy });
  }
  if (sel.node && sel.node.type !== 'frame') {
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
