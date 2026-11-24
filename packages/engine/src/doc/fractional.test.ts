import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyBetween, keysAfter } from './fractional.ts';

test('keys sort between their neighbours', () => {
  const keys = keysAfter(null, 20);
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i - 1]! < keys[i]!);
  // Insert repeatedly at the front and between neighbours.
  let front = keys[0]!;
  for (let i = 0; i < 200; i++) {
    const k = keyBetween(null, front);
    assert.ok(k < front);
    front = k;
  }
  let lo = keys[3]!, hi = keys[4]!;
  for (let i = 0; i < 200; i++) {
    const k = keyBetween(lo, hi);
    assert.ok(lo < k && k < hi, `${lo} < ${k} < ${hi}`);
    if (i % 2) lo = k; else hi = k;
  }
});

test('rejects out-of-order bounds', () => {
  assert.throws(() => keyBetween('b', 'a'));
});
