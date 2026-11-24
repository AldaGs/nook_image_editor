// Hit-testing: which nodes are under a point, and which a marquee touches.

import { apply, invert, intersects, type Point, type Rect } from '../geom/affine.ts';
import type { Doc } from '../doc/document.ts';
import type { Node } from '../doc/types.ts';
import { localBox, worldBounds } from './bounds.ts';
import { pathContains, shapePath } from '../doc/shapes.ts';

/** Is a world point inside this node's own shape? `slop` widens it (world units). */
function inside(doc: Doc, node: Node, p: Point, slop: number): boolean {
  const box = localBox(doc, node);
  const q = apply(invert(doc.worldTransform(node.id)), p);
  const path = shapePath(node);
  if (path) return pathContains(path, q, slop + Math.max(0, ...node.strokes.map(s => s.width / 2)));
  if (node.type === 'ellipse') {
    const rx = box.width / 2 + slop, ry = box.height / 2 + slop;
    const dx = q.x - box.x - box.width / 2, dy = q.y - box.y - box.height / 2;
    return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
  }
  return q.x >= box.x - slop && q.x <= box.x + box.width + slop && q.y >= box.y - slop && q.y <= box.y + box.height + slop;
}

/**
 * Selectable nodes under `p`, topmost first. A hit inside a group selects the
 * outermost group (like Figma); the frame itself comes after its contents.
 * Hidden and locked nodes are skipped.
 */
export function hitStack(doc: Doc, pageId: string, p: Point, slop = 0): Node[] {
  const out: Node[] = [];
  const visit = (parentId: string, groupRoot: Node | null) => {
    const kids = doc.children(parentId);
    for (let i = kids.length - 1; i >= 0; i--) {
      const n = kids[i]!;
      if (!n.visible || n.locked) continue;
      if (n.type === 'frame') {
        // Clipped frames only contain hits inside their box.
        if (n.clipContent && !inside(doc, n, p, slop)) continue;
        visit(n.id, null);
        if (inside(doc, n, p, slop)) out.push(n);
      } else if (n.type === 'group' || n.type === 'boolean') {
        visit(n.id, groupRoot ?? n);
      } else if (inside(doc, n, p, slop)) {
        const pick = groupRoot ?? n;
        if (!out.includes(pick)) out.push(pick);
      }
    }
  };
  visit(pageId, null);
  return out;
}

/** The deepest frame under a point (used to parent new and dropped shapes). `skip` excludes frames being dragged. */
export function frameAt(doc: Doc, pageId: string, p: Point, skip?: Set<string>): Node | null {
  let found: Node | null = null;
  const visit = (parentId: string) => {
    for (const n of doc.children(parentId)) {
      if (n.type === 'frame' && n.visible && !skip?.has(n.id) && inside(doc, n, p, 0)) { found = n; visit(n.id); }
    }
  };
  visit(pageId);
  return found;
}

/**
 * Nodes a marquee selects: children of the page and of top-level frames whose
 * bounds intersect it. A frame is only picked when the marquee contains it fully.
 */
export function marqueeHits(doc: Doc, pageId: string, rect: Rect): Node[] {
  const out: Node[] = [];
  for (const n of doc.children(pageId)) {
    if (!n.visible || n.locked) continue;
    const b = worldBounds(doc, [n]);
    if (!b || !intersects(b, rect)) continue;
    if (n.type === 'frame') {
      const contained = b.x >= rect.x && b.y >= rect.y && b.x + b.width <= rect.x + rect.width && b.y + b.height <= rect.y + rect.height;
      if (contained) { out.push(n); continue; }
      for (const c of doc.children(n.id)) {
        const cb = worldBounds(doc, [c]);
        if (c.visible && !c.locked && cb && intersects(cb, rect)) out.push(c);
      }
    } else {
      out.push(n);
    }
  }
  return out;
}
