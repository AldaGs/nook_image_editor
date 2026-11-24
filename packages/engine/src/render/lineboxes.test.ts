import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bubble, lineBoxes } from './renderer.ts';

test('one padded box per line with text; empty lines get none', () => {
  const l = (left: number, width: number, baseline: number) => ({ left, width, baseline, ascent: 16, descent: 4 });
  assert.deepEqual(lineBoxes([l(10, 100, 16), l(0, 0, 36), l(30, 40, 56)], 8), [
    { x: 2, y: -4, width: 116, height: 28 },
    { x: 22, y: 36, width: 56, height: 28 },
  ]);
});

test('a bubble wraps every line, with its tail on the text side', () => {
  const b = bubble([{ x: 0, y: 0, width: 100, height: 20 }, { x: 20, y: 20, width: 60, height: 20 }], 10, 'left')!;
  assert.deepEqual(b.box, { x: 0, y: 0, width: 100, height: 50 });
  assert.equal(b.radius, 15);
  assert.deepEqual(b.tail.at(-1), { x: 15, y: 62 });
  assert.equal(bubble([], 10, 'left'), null);
});
