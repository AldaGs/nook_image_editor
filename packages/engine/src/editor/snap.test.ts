import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapBox } from './snap.ts';

test('snaps the nearest edge or centre within tolerance, with a guide', () => {
  const other = { x: 100, y: 0, width: 50, height: 50 };
  // Left edge 3 units right of other's right edge (150) → pulled back to 150.
  const r = snapBox({ x: 153, y: 200, width: 20, height: 20 }, [other], 5);
  assert.equal(r.dx, -3);
  assert.equal(r.dy, 0);
  assert.deepEqual(r.guides, [{ a: { x: 150, y: 0 }, b: { x: 150, y: 220 } }]);
  // Centre-to-centre on y.
  assert.equal(snapBox({ x: 500, y: 14, width: 20, height: 20 }, [other], 5).dy, 1);
  // Out of range: nothing.
  assert.deepEqual(snapBox({ x: 300, y: 300, width: 10, height: 10 }, [other], 5), { dx: 0, dy: 0, guides: [] });
});
