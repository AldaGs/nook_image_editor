import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bezierAt, segments } from '../../doc/shapes.ts';
import { nearestOnPath, splitAt } from './points.ts';

const curve = { closed: false, anchors: [
  { p: { x: 0, y: 0 }, in: { x: 0, y: 0 }, out: { x: 30, y: -60 } },
  { p: { x: 100, y: 0 }, in: { x: -30, y: -60 }, out: { x: 0, y: 0 } },
] };

test('splitting a curve adds a point on it and keeps its shape', () => {
  const { path, index } = splitAt(curve, 0, 0.3);
  assert.equal(index, 1);
  assert.equal(path.anchors.length, 3);
  const before = segments(curve)[0]!;
  const [a, b] = segments(path);
  const close = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9;
  assert.ok(close(path.anchors[1]!.p, bezierAt(before, 0.3)));
  // Points on each half land on the original curve.
  assert.ok(close(bezierAt(a!, 0.5), bezierAt(before, 0.15)));
  assert.ok(close(bezierAt(b!, 0.5), bezierAt(before, 0.65)));
});

test('the nearest point on a path finds the right segment and parameter', () => {
  const hit = nearestOnPath(curve, bezierAt(segments(curve)[0]!, 0.75));
  assert.equal(hit.seg, 0);
  assert.ok(Math.abs(hit.t - 0.75) < 0.02 && hit.dist < 0.5);
});
