import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor, starterDoc } from '@nook/engine';
import { exportPbc } from './pbc.ts';

test('each frame becomes a comp with centred shape layers', () => {
  const ed = new Editor(starterDoc());
  const { text, report } = exportPbc(ed.doc, ed.pageId);
  const { project } = JSON.parse(text);
  assert.deepEqual(Object.keys(project.comps), ['1', '2', '3']);
  assert.equal(project.root, 1);

  const comp = project.comps['1'];
  assert.equal(comp.width, 1080);
  assert.equal(comp.height, 1350);
  const card = comp.root.children[0];
  assert.equal(card.name, 'Card');
  // The rect is 600×600 at (240, 375) in the frame → centre (540, 675).
  assert.deepEqual(card.transform.position.Const, { x: 540, y: 675, z: 0 });
  assert.deepEqual(card.shape.Rect.size.Const, { x: 600, y: 600 });
  assert.deepEqual(report, []);
});

test('groups keep their children and names', () => {
  const ed = new Editor(starterDoc());
  const frame = ed.doc.children(ed.pageId)[0]!;
  ed.select([ed.doc.children(frame.id)[0]!.id]);
  ed.group();
  ed.rename(ed.selection[0]!, 'Hero');
  const { project } = JSON.parse(exportPbc(ed.doc, ed.pageId).text);
  const group = project.comps['1'].root.children[0];
  assert.equal(group.name, 'Hero');
  assert.equal(group.shape, null);
  assert.equal(group.children[0].name, 'Card');
  // Ids are unique within the comp.
  const ids: number[] = [];
  const walk = (n: { id: number; children: unknown[] }) => { ids.push(n.id); n.children.forEach(c => walk(c as never)); };
  walk(project.comps['1'].root);
  assert.equal(new Set(ids).size, ids.length);
});
