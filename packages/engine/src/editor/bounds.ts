// Node geometry: each node's box in its own space, and its corners in world space.
// Groups have no box of their own; theirs is the union of their children.

import { boundsOf, corners, invert, multiply, type Affine, type Point, type Rect } from '../geom/affine.ts';
import type { Doc } from '../doc/document.ts';
import type { Node } from '../doc/types.ts';

/** The node's box in its own local space. */
export function localBox(doc: Doc, node: Node): Rect {
  if (node.type !== 'group') return { x: 0, y: 0, width: node.width, height: node.height };
  const pts = doc.children(node.id).flatMap(c => corners(c.transform, localBox(doc, c)));
  return boundsOf(pts) ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** The node's box as four world-space corners (clockwise from top-left). */
export function worldCorners(doc: Doc, node: Node): Point[] {
  return corners(doc.worldTransform(node.id), localBox(doc, node));
}

/** Axis-aligned world bounds of several nodes. */
export function worldBounds(doc: Doc, nodes: Node[]): Rect | null {
  return boundsOf(nodes.flatMap(n => worldCorners(doc, n)));
}

/** Transform mapping world space into a node's parent space. */
export function worldToParent(doc: Doc, node: Node): Affine {
  return node.parentId ? invert(doc.worldTransform(node.parentId)) : [1, 0, 0, 1, 0, 0];
}

/** Local transform that keeps `world` placement when the node moves under `parentId`. */
export function localFor(doc: Doc, world: Affine, parentId: string | null): Affine {
  return parentId ? multiply(invert(doc.worldTransform(parentId)), world) : world;
}
