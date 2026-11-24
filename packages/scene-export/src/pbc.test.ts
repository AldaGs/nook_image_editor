import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor, linear, newEffect, solid, starterDoc } from '@nook/engine';
import { createNode } from '../../engine/src/doc/factory.ts';
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

test('gradients, strokes, blend modes and effects map onto PBC fields', () => {
  const ed = new Editor(starterDoc());
  const card = ed.doc.children(ed.doc.children(ed.pageId)[0]!.id)[0]!; // 600×600 at (240, 375)
  ed.setProp([card.id], 'fills', [linear({ r: 1, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 1, a: 1 })]); // top centre → bottom centre
  ed.setProp([card.id], 'strokes', [{ paint: solid({ r: 0, g: 0, b: 0, a: 1 }), width: 4, align: 'inside' }]);
  ed.setProp([card.id], 'blendMode', 'colorDodge');
  ed.setProp([card.id], 'effects', [newEffect('dropShadow'), newEffect('layerBlur'), newEffect('innerShadow')]);
  const { text, report } = exportPbc(ed.doc, ed.pageId);
  const layer = JSON.parse(text).project.comps['1'].root.children[0];

  assert.equal(layer.gradient.kind, 'Linear');
  // Unit box (0.5, 0) → centred layer space (0, -300).
  assert.deepEqual(layer.gradient.start.Const, { x: 0, y: -300 });
  assert.deepEqual(layer.gradient.end.Const, { x: 0, y: 300 });
  assert.equal(layer.fill.Const.r, 0.5, 'the flat fallback is the average colour');
  assert.equal(layer.stroke.width.Const, 4);
  assert.equal(layer.blend, 'ColorDodge');
  assert.deepEqual(layer.effects.map((e: { kind: object }) => Object.keys(e.kind)[0]), ['DropShadow', 'GaussianBlur']);
  assert.equal(layer.effects[0].kind.DropShadow.radius.Const, 4, 'blur 8 is sigma 4');
  assert.equal(layer.effects[0].kind.DropShadow.opacity.Const, 0.25);
  assert.ok(report.some(r => r.includes('inner shadow')));
  assert.ok(report.some(r => r.includes('centred on the outline')));
});

test('text is centred on its laid-out block, as PBC draws it', () => {
  const ed = new Editor(starterDoc());
  const frame = ed.doc.children(ed.pageId)[0]!;
  const node = createNode('text', { parentId: frame.id, order: 'z', transform: [1, 0, 0, 1, 100, 200], width: 500, height: 300 });
  node.text = { ...node.text!, content: 'Hi there', size: 40, letterSpacing: 2, lineHeight: 50, align: 'left', sizing: 'fixed' };
  ed.transact('Add text', () => [{ t: 'add', node }]);
  // Widest line 200, two lines of 50.
  const { text, report } = exportPbc(ed.doc, ed.pageId, { measure: () => ({ width: 200, height: 100 }) });
  const layer = JSON.parse(text).project.comps['1'].root.children[1];

  const t = layer.shape.Text;
  assert.equal(t.content.Const, 'Hi there');
  assert.equal(t.max_width, 500, 'a fixed box wraps at its width');
  assert.equal(t.tracking.Const, 50, '2px at 40px is 50/1000 em');
  assert.equal(t.leading.Const, 50);
  assert.equal(t.align, 'Left');
  // Left-aligned: the block's centre is half its widest line in from the box's left, half its height down.
  assert.deepEqual(layer.transform.position.Const, { x: 200, y: 250, z: 0 });
  assert.ok(report.some(r => r.startsWith('Fonts used: Inter')));
});
