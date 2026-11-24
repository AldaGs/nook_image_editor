import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapBox, snapEdges } from './snap.ts';

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

test('equal spacing: centres between two boxes, or repeats a neighbour gap', () => {
  const a = { x: 0, y: 0, width: 100, height: 100 };
  const b = { x: 300, y: 0, width: 100, height: 100 };
  // Between a and b (gap 100–300), a 50-wide box centres at x=175.
  assert.equal(snapBox({ x: 178, y: 7, width: 50, height: 50 }, [a, b], 5).dx, -3);
  // Right of b with the same 200 gap → x=600.
  const r = snapBox({ x: 603, y: 13, width: 100, height: 50 }, [a, b], 5);
  assert.equal(r.dx, -3);
  assert.ok(r.guides.some(g => g.a.x === 400 && g.b.x === 600));
  // Out of the row: no spacing snap.
  assert.equal(snapBox({ x: 603, y: 500, width: 100, height: 50 }, [a, b], 5).dx, 0);
});

test('snapEdges pulls only the dragged edge onto a nearby edge', () => {
  const r = snapEdges({ x: 0, y: 0, width: 97, height: 50 }, { x: 'hi' }, [{ x: 100, y: 200, width: 40, height: 40 }], 6);
  assert.deepEqual(r.box, { x: 0, y: 0, width: 100, height: 50 });
  assert.equal(r.guides.length, 1);
});
