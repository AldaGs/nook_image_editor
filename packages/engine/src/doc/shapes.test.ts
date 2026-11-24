import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNode } from './factory.ts';
import { bezierAt, contoursFromCmds, pathBounds, pathContains, segments, shapePath } from './shapes.ts';

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

test('a curve bounds its drawn shape, not its handles', () => {
  // Endpoints on y = 0 with handles up at y = -40: the curve peaks at y = -30.
  const path = { closed: false, anchors: [
    { p: { x: 0, y: 0 }, in: { x: 0, y: 0 }, out: { x: 0, y: -40 } },
    { p: { x: 100, y: 0 }, in: { x: 0, y: -40 }, out: { x: 0, y: 0 } },
  ] };
  const b = pathBounds(path);
  assert.ok(Math.abs(b.y + 30) < 0.5 && b.height < 31 && b.width === 100);
});

const V = { move: 0, line: 1, quad: 2, conic: 3, cubic: 4, close: 5 };

test('Skia commands become contours: a closed square and a separate triangle', () => {
  const cmds = [0, 0, 0, 1, 10, 0, 1, 10, 10, 1, 0, 10, 5, 0, 20, 0, 1, 30, 0, 1, 25, 8, 5];
  const out = contoursFromCmds(cmds, V);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0]!.anchors.map(a => a.p), [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
  assert.equal(out[0]!.closed, true);
  assert.equal(out[1]!.anchors.length, 3);
});

test('a conic quarter circle becomes a cubic that stays on the circle', () => {
  // Quarter of a radius-100 circle round (0,0), from (100,0) to (0,100), weight √2/2; closed back to its start.
  const w = Math.SQRT1_2;
  const out = contoursFromCmds([0, 100, 0, 3, 100, 100, 0, 100, w, 1, 100, 0, 5], V);
  const [p0, c1, c2, p3] = segments(out[0]!)[0]!;
  const mid = bezierAt([p0, c1, c2, p3], 0.5);
  assert.ok(Math.abs(Math.hypot(mid.x, mid.y) - 100) < 0.1);
  assert.equal(out[0]!.anchors.length, 2); // the closing line's duplicate end point is dropped
});
