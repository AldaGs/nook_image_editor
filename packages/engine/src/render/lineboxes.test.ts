import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineBoxes } from './renderer.ts';

test('one padded box per line with text; empty lines get none', () => {
  const l = (left: number, width: number, baseline: number) => ({ left, width, baseline, ascent: 16, descent: 4 });
  assert.deepEqual(lineBoxes([l(10, 100, 16), l(0, 0, 36), l(30, 40, 56)], 8), [
    { x: 2, y: -4, width: 116, height: 28 },
    { x: 22, y: 36, width: 56, height: 28 },
  ]);
});
