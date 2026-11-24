import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from './camera.ts';

test('zoomAt keeps the point under the cursor fixed', () => {
  const cam = new Camera();
  cam.panBy(-40, 25);
  const screen = { x: 120, y: 80 };
  const before = cam.screenToWorld(screen);
  cam.zoomAt(screen, 2.5);
  const after = cam.screenToWorld(screen);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
});

test('screenToWorld and worldToScreen are inverses', () => {
  const cam = new Camera();
  cam.zoomAt({ x: 10, y: 10 }, 3);
  cam.panBy(7, -3);
  const p = { x: 42, y: -17 };
  const back = cam.screenToWorld(cam.worldToScreen(p));
  assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9);
});

test('fit centres the rect', () => {
  const cam = new Camera();
  cam.fit({ x: 0, y: 0, width: 1080, height: 1350 }, { width: 400, height: 800 });
  const c = cam.worldToScreen({ x: 540, y: 675 });
  assert.ok(Math.abs(c.x - 200) < 1e-9 && Math.abs(c.y - 400) < 1e-9);
});
