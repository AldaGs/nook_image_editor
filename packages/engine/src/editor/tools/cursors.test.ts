import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resizeCursor } from './cursors.ts';
import { safeZoneRects } from '../../doc/factory.ts';

test('resize arrows follow the handle direction on screen', () => {
  const c = { x: 0, y: 0 };
  assert.equal(resizeCursor(c, { x: 10, y: 0 }), 'ew-resize');
  assert.equal(resizeCursor(c, { x: 10, y: 10 }), 'nwse-resize');
  assert.equal(resizeCursor(c, { x: 0, y: -10 }), 'ns-resize');
  assert.equal(resizeCursor(c, { x: 10, y: -10 }), 'nesw-resize');
  assert.equal(resizeCursor(c, { x: -10, y: 0 }), 'ew-resize');
});

test('safe zones: story strips, IG grid crop on 4:5 and 1:1, none elsewhere', () => {
  assert.equal(safeZoneRects(1080, 1920).length, 3);
  assert.deepEqual(safeZoneRects(1080, 1350).map(r => r.width), [33.75, 33.75]);
  assert.deepEqual(safeZoneRects(1080, 1080).map(r => r.width), [135, 135]);
  assert.equal(safeZoneRects(1920, 1080).length, 0);
});
