import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentColors, hsvToRgb, parseHex, rgbToHsv, toHex } from './color.ts';
import { starterDoc } from './serialize.ts';

test('hex parses every short and long form and prints back', () => {
  assert.deepEqual(parseHex('#fff'), { r: 1, g: 1, b: 1, a: 1 });
  assert.deepEqual(parseHex('000000'), { r: 0, g: 0, b: 0, a: 1 });
  assert.equal(parseHex('#ff000080')!.a, 128 / 255);
  assert.equal(parseHex('#f008')!.a, 136 / 255);
  assert.equal(parseHex('#12345'), null);
  assert.equal(parseHex('tomato'), null);
  assert.equal(toHex({ r: 1, g: 0.5, b: 0, a: 1 }), '#ff8000');
  assert.equal(toHex({ r: 1, g: 0.5, b: 0, a: 0.5 }, true), '#ff800080');
  assert.equal(toHex({ r: 1, g: 0.5, b: 0, a: 1 }, true), '#ff8000', 'opaque colours keep the short form');
});

test('HSV round-trips without drifting', () => {
  for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#6d4aff', '#808080', '#000000', '#ffffff', '#123456']) {
    const c = parseHex(hex)!;
    assert.equal(toHex(hsvToRgb(rgbToHsv(c))), hex);
  }
  assert.deepEqual(rgbToHsv({ r: 1, g: 0, b: 0, a: 1 }), { h: 0, s: 1, v: 1, a: 1 });
  assert.equal(Math.round(rgbToHsv(parseHex('#0000ff')!).h), 240);
  assert.equal(rgbToHsv({ r: 0.5, g: 0.5, b: 0.5, a: 1 }).s, 0, 'grays have no saturation');
});

test('document colours list the most used first', () => {
  const doc = starterDoc();
  const colours = documentColors(doc).map(c => toHex(c));
  // Three white boards, three cards of the same purple.
  assert.deepEqual(colours.sort(), ['#6d4aff', '#ffffff']);
});
