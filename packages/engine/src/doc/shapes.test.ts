import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNode } from './factory.ts';
import { pathContains, shapePath } from './shapes.ts';

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('a star alternates outer and inner points, starting at the top', () => {
  const n = createNode('star', { parentId: null, order: 'a', width: 100, height: 100 });
  const { anchors, closed } = shapePath(n)!;
  assert.equal(closed, true);
  assert.equal(anchors.length, 10);
  assert.ok(close(anchors[0]!.p.x, 50) && close(anchors[0]!.p.y, 0));
  assert.ok(close(Math.hypot(anchors[1]!.p.x - 50, anchors[1]!.p.y - 50), 20)); // inner ratio 0.4
});

test('hits: inside a triangle, near a line, not in its empty corner', () => {
  const tri = shapePath(createNode('polygon', { parentId: null, order: 'a', width: 100, height: 100 }))!;
  assert.equal(pathContains(tri, { x: 50, y: 50 }, 0), true);
  assert.equal(pathContains(tri, { x: 5, y: 5 }, 0), false);
  const line = shapePath(createNode('line', { parentId: null, order: 'a', width: 100, height: 0 }))!;
  assert.equal(pathContains(line, { x: 50, y: 3 }, 4), true);
  assert.equal(pathContains(line, { x: 50, y: 10 }, 4), false);
});
