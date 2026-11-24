import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from './editor.ts';
import { worldCorners } from './bounds.ts';
import { starterDoc, toFile, fromFile } from '../doc/serialize.ts';
import { FRAME_PRESETS } from '../doc/factory.ts';
import { rotation, multiply, translation } from '../geom/affine.ts';
import type { Node } from '../doc/types.ts';

const shapes = (ed: Editor) => [...ed.doc.nodes.values()].filter(n => n.type === 'rect');
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const sameCorners = (a: { x: number; y: number }[], b: { x: number; y: number }[]) =>
  a.every((p, i) => near(p.x, b[i]!.x) && near(p.y, b[i]!.y));

test('100 moves undo back to the start and redo forward again', () => {
  const ed = new Editor(starterDoc());
  const rect = shapes(ed)[0]!;
  const start = [...rect.transform];
  for (let i = 0; i < 100; i++) {
    const n = ed.doc.get(rect.id)!;
    ed.transact('Move', () => ed.moveOps([n], new Map([[n.id, n.transform]]), 1, 2));
  }
  assert.equal(ed.doc.get(rect.id)!.transform[4], start[4]! + 100);
  for (let i = 0; i < 100; i++) ed.undo();
  assert.deepEqual(ed.doc.get(rect.id)!.transform, start);
  for (let i = 0; i < 100; i++) ed.redo();
  assert.equal(ed.doc.get(rect.id)!.transform[5], start[5]! + 200);
});

test('a drag (rewind + reapply) is one undo step', () => {
  const ed = new Editor(starterDoc());
  const rect = shapes(ed)[0]!;
  const t0 = rect.transform;
  ed.history.begin('Move');
  for (let i = 1; i <= 10; i++) {
    ed.history.rewind();
    ed.transact('Move', () => ed.moveOps([rect], new Map([[rect.id, t0]]), i * 5, 0));
  }
  ed.history.commit();
  assert.equal(ed.doc.get(rect.id)!.transform[4], t0[4] + 50);
  ed.undo();
  assert.deepEqual(ed.doc.get(rect.id)!.transform, t0);
  assert.equal(ed.history.canUndo, false);
});

test('group and ungroup keep shapes where they are on screen', () => {
  const ed = new Editor(starterDoc());
  const frame = ed.doc.children(ed.pageId)[0]!;
  // Rotate the frame so parent space differs from world space.
  ed.setProp([frame.id], 'transform', multiply(translation(50, 80), rotation(0.3)));
  const rect = ed.doc.children(frame.id)[0]!;
  const before = worldCorners(ed.doc, rect);

  ed.select([rect.id]);
  ed.group();
  const group = ed.doc.get(ed.selection[0]!)!;
  assert.equal(group.type, 'group');
  assert.equal(ed.doc.get(rect.id)!.parentId, group.id);
  assert.ok(sameCorners(worldCorners(ed.doc, ed.doc.get(rect.id)!), before));

  // Move the group, then ungroup: the rect keeps the moved position.
  ed.transact('Move', () => ed.moveOps([group], new Map([[group.id, group.transform]]), 10, 0));
  ed.ungroup();
  assert.equal(ed.doc.get(group.id), undefined);
  const after = worldCorners(ed.doc, ed.doc.get(rect.id)!);
  assert.ok(sameCorners(after, before.map(p => ({ x: p.x + 10, y: p.y }))));
});

test('reorder, delete and undo', () => {
  const ed = new Editor(starterDoc());
  const frame = ed.addFrame(FRAME_PRESETS[2]);
  const boards = () => ed.doc.children(ed.pageId).map(n => n.id);
  assert.equal(boards().at(-1), frame.id);
  ed.reorder(frame.id, -1);
  assert.equal(boards().at(-2), frame.id);

  const first = ed.doc.children(ed.pageId)[0]!;
  const count = ed.doc.nodes.size;
  ed.select([first.id]);
  ed.deleteSelection();
  assert.equal(ed.doc.nodes.size, count - 2); // the frame and its rect
  ed.undo();
  assert.equal(ed.doc.nodes.size, count);
  assert.ok(ed.doc.get(first.id));
});

test('doc.json round-trips', () => {
  const ed = new Editor(starterDoc());
  const back = fromFile(JSON.parse(JSON.stringify(toFile(ed.doc))));
  const sort = (ns: Node[]) => [...ns].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(sort([...back.nodes.values()]), sort([...ed.doc.nodes.values()]));
});
