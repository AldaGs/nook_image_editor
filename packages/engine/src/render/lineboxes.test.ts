import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bubble, lineBoxes, outlineEdge } from './renderer.ts';

test('one padded box per line with text; empty lines get none', () => {
  const l = (left: number, width: number, baseline: number) => ({ left, width, baseline, ascent: 16, descent: 4 });
  assert.deepEqual(lineBoxes([l(10, 100, 16), l(0, 0, 36), l(30, 40, 56)], 8), [
    { x: 2, y: -4, width: 116, height: 28 },
    { x: 22, y: 36, width: 56, height: 28 },
  ]);
});

test('a bubble wraps every line; its tail slides along the bottom, sized, or is left off', () => {
  const lines = [{ x: 0, y: 0, width: 100, height: 20 }, { x: 20, y: 20, width: 60, height: 20 }];
  const left = bubble(lines, 10, { at: 0, size: 12 })!;
  assert.deepEqual(left.box, { x: 0, y: 0, width: 100, height: 50 });
  assert.equal(left.radius, 15);
  assert.deepEqual(left.tail, [{ x: 15, y: 49 }, { x: 27, y: 49 }, { x: 15, y: 62 }]);
  const right = bubble(lines, 10, { at: 1, size: 20 })!;
  assert.deepEqual(right.tail, [{ x: 65, y: 49 }, { x: 85, y: 49 }, { x: 85, y: 70 }]);
  assert.deepEqual(bubble(lines, 10, null)!.tail, []);
  assert.equal(bubble([], 10, null), null);
});

test('the sticker edge ramp spans about one device pixel at any zoom', () => {
  // Over one device pixel either side of the 0.4 crossing, alpha moves from transparent toward opaque.
  for (const scale of [0.25, 1, 4]) {
    const sigma = 5.6, [k, bias] = outlineEdge(sigma, scale);
    const slopePerDevicePx = 1 / (2.5 * sigma * scale);
    assert.ok(Math.abs(k * slopePerDevicePx - 1) < 1e-9);
    assert.ok(Math.abs(k * 0.4 + bias - 0.5) < 1e-9);
  }
  assert.equal(outlineEdge(0.1, 0.1)[0], 1); // never softer than the blur itself
});
