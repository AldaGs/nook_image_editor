import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from './editor.ts';
import { worldCorners } from './bounds.ts';
import { starterDoc, toFile, fromFile } from '../doc/serialize.ts';
import { createNode, FRAME_PRESETS } from '../doc/factory.ts';
import { rotation, multiply, translation } from '../geom/affine.ts';
import { linear, type Node } from '../doc/types.ts';

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

test('dropping a shape on another frame moves it there, off-frame puts it on the page, one undo step', () => {
  const ed = new Editor(starterDoc());
  const [f1, f2] = ed.doc.children(ed.pageId);
  const card = ed.doc.children(f1!.id)[0]!;
  const before = worldCorners(ed.doc, card);
  const inF2 = { x: f2!.transform[4] + 10, y: f2!.transform[5] + 10 };

  ed.history.begin('Move');
  ed.dropAt([card], inF2);
  ed.history.commit();
  assert.equal(ed.doc.get(card.id)!.parentId, f2!.id);
  assert.ok(sameCorners(worldCorners(ed.doc, ed.doc.get(card.id)!), before));
  // On top of its new siblings.
  assert.equal(ed.doc.children(f2!.id).at(-1)!.id, card.id);

  ed.dropAt([ed.doc.get(card.id)!], { x: -1e5, y: -1e5 });
  assert.equal(ed.doc.get(card.id)!.parentId, ed.pageId);

  ed.undo();
  ed.undo();
  assert.equal(ed.doc.get(card.id)!.parentId, f1!.id);
  assert.ok(sameCorners(worldCorners(ed.doc, ed.doc.get(card.id)!), before));
});

test('a board dragged over another board stays top-level', () => {
  const ed = new Editor(starterDoc());
  const [f1, f2] = ed.doc.children(ed.pageId);
  ed.dropAt([f1!], { x: f2!.transform[4] + 10, y: f2!.transform[5] + 10 });
  assert.equal(ed.doc.get(f1!.id)!.parentId, ed.pageId);
});

test('resizing a group stretches its children by size, not by scaled transforms', () => {
  const ed = new Editor(starterDoc());
  const frames = ed.doc.children(ed.pageId);
  const [a, b] = frames.map(f => ed.doc.children(f.id)[0]!);
  // Two cards in one group (b moved into a's frame first).
  ed.transact('t', () => ed.reparentOps(b!, frames[0]!.id, 'zz'));
  ed.select([a!.id, b!.id]);
  ed.group();
  const g = ed.doc.get(ed.selection[0]!)!;
  const { width: w0, height: h0 } = ed.doc.get(a!.id)!;
  const toWorld = ed.doc.worldTransform(g.id);
  const box = { x: 0, y: 0, width: 100, height: 100 };
  ed.transact('Resize', () => ed.scaleOps([g], toWorld, box, { x: 0, y: 0, width: 200, height: 50 }));
  const a2 = ed.doc.get(a!.id)!;
  assert.equal(a2.width, w0 * 2);
  assert.equal(a2.height, h0 / 2);
  assert.deepEqual(a2.transform.slice(0, 4), [1, 0, 0, 1]);
  ed.undo();
  assert.equal(ed.doc.get(a!.id)!.width, w0);
});

test('a uniform multi-selection resize keeps a rotated shape rotated and scales it about the box', () => {
  const ed = new Editor(starterDoc());
  const card = ed.doc.children(ed.doc.children(ed.pageId)[0]!.id)[0]!;
  const t = multiply(card.transform, rotation(Math.PI / 6));
  ed.setProp([card.id], 'transform', t);
  const before = worldCorners(ed.doc, ed.doc.get(card.id)!);
  ed.transact('Resize', () => ed.scaleOps([ed.doc.get(card.id)!], translation(0, 0), { x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 30, height: 30 }));
  const after = worldCorners(ed.doc, ed.doc.get(card.id)!);
  assert.ok(sameCorners(after, before.map(p => ({ x: p.x * 3, y: p.y * 3 }))));
});

test('the doc reports touched ids, including the old parent of a moved node', () => {
  const ed = new Editor(starterDoc());
  const [f1, f2] = ed.doc.children(ed.pageId);
  const card = ed.doc.children(f1!.id)[0]!;
  ed.doc.takeTouched();
  ed.transact('t', () => ed.reparentOps(card, f2!.id, 'zz'));
  assert.deepEqual([...ed.doc.takeTouched()].sort(), [card.id, f1!.id].sort());
  assert.equal(ed.doc.takeTouched().size, 0);
  ed.select([card.id]);
  ed.deleteSelection();
  assert.deepEqual([...ed.doc.takeTouched()].sort(), [card.id, f2!.id].sort());
});

test('gradient editing targets one paint and lets go when it stops being a gradient', () => {
  const ed = new Editor(starterDoc());
  const card = ed.doc.children(ed.doc.children(ed.pageId)[0]!.id)[0]!;
  ed.select([card.id]);
  const t = { nodeId: card.id, prop: 'fills' as const, index: 0 };
  ed.editGradient(t);
  assert.equal(ed.gradientEdit, null, 'a solid fill has no gradient handles');

  ed.setProp([card.id], 'fills', [linear({ r: 1, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 1, a: 1 })]);
  ed.editGradient(t);
  assert.ok(ed.gradientEdit);
  ed.transact('Edit gradient', () => ed.setGradientOps(t, { ...ed.gradientPaint(t)!, to: { x: 1, y: 1 } }));
  assert.deepEqual((ed.doc.get(card.id)!.fills[0] as { to: unknown }).to, { x: 1, y: 1 });

  ed.undo();
  ed.undo(); // back to solid: the handles go away
  assert.equal(ed.gradientEdit, null);
});

test('auto-sized text boxes follow their text; a resized box keeps its size', () => {
  const ed = new Editor(starterDoc());
  const frame = ed.doc.children(ed.pageId)[0]!;
  // A stand-in measurer: 10px per character, 20px per line, wrapping at the width.
  ed.measureText = (t, width) => {
    const lines = t.content.split('\n');
    const w = Math.max(...lines.map(l => l.length)) * 10;
    return { width: width ?? w, height: (width ? lines.reduce((s, l) => s + Math.max(1, Math.ceil((l.length * 10) / width)), 0) : lines.length) * 20 };
  };
  const node = createNode('text', { parentId: frame.id, order: 'z' });
  ed.transact('Add text', () => [{ t: 'add', node }]);

  ed.previewText([node.id], { content: 'Hello\nworld!!' });
  ed.commitEdit();
  let n = ed.doc.get(node.id)!;
  assert.deepEqual([n.width, n.height], [70, 40], 'auto width hugs the longest line');

  ed.previewText([node.id], { sizing: 'autoHeight' });
  ed.commitEdit();
  ed.setProp([node.id], 'width', 30);
  ed.previewText([node.id], { content: 'abcdefghij' }); // 100px of text in a 30px box
  ed.commitEdit();
  n = ed.doc.get(node.id)!;
  assert.deepEqual([n.width, n.height], [30, 80], 'auto height wraps at the width and grows down');

  ed.transact('Resize', () => ed.scaleOps([n], ed.doc.worldTransform(n.id), { x: 0, y: 0, width: 30, height: 80 }, { x: 0, y: 0, width: 60, height: 80 }));
  assert.equal(ed.doc.get(node.id)!.text!.sizing, 'fixed');

  ed.undo();
  assert.equal(ed.doc.get(node.id)!.text!.sizing, 'autoHeight');
});
