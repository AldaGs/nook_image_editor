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
  assert.deepEqual(layer.effects.map((e: { kind: object }) => Object.keys(e.kind)[0]), ['DropShadow', 'GaussianBlur', 'InnerShadow']);
  assert.equal(layer.effects[0].kind.DropShadow.radius.Const, 4, 'blur 8 is sigma 4');
  assert.equal(layer.effects[0].kind.DropShadow.opacity.Const, 0.25);
  assert.equal(layer.effects[0].kind.DropShadow.spread.Const, 0);
  assert.equal(layer.stroke.style.align, 'Inside');
  assert.ok(!report.some(r => r.includes('inner shadow') || r.includes('centred')));
});

test('gradient strokes, and paths with holes as one Vector with contours', () => {
  const ed = new Editor(starterDoc());
  const board = ed.doc.children(ed.pageId)[0]!;
  const sq = (x: number, s: number) => ({ closed: true, anchors: [[x, x], [x + s, x], [x + s, x + s], [x, x + s]].map(([px, py]) => ({ p: { x: px!, y: py! }, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } })) });
  const v = createNode('vector', { parentId: board.id, order: 'y', name: 'Ring', width: 100, height: 100, path: sq(0, 100), subpaths: [sq(25, 50)], fillRule: 'evenodd' });
  v.strokes = [{ paint: linear({ r: 1, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 1, a: 1 }), width: 3, align: 'center' }];
  ed.transact('Add', () => [{ t: 'add', node: v }]);
  const { text, report } = exportPbc(ed.doc, ed.pageId);
  const layer = JSON.parse(text).project.comps['1'].root.children.at(-1);
  const path = layer.shape.Vector.path;
  assert.equal(path.anchors.length, 4);
  assert.equal(path.contours.length, 1);
  assert.deepEqual(path.contours[0].anchors[0].point.Const, { x: 25, y: 25 });
  assert.equal(path.even_odd, true);
  assert.equal(layer.stroke_gradient.kind, 'Linear');
  assert.equal(layer.stroke.style, undefined, 'centred strokes keep the default style');
  assert.ok(!report.some(r => r.includes('Ring')));
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

test('a frame inside a frame becomes a precomp clipped by a mask', () => {
  const ed = new Editor(starterDoc());
  const outer = ed.doc.children(ed.pageId)[0]!;
  const inner = createNode('frame', { parentId: outer.id, order: 'z', name: 'Window', transform: [1, 0, 0, 1, 100, 50], width: 300, height: 200 });
  inner.fills = [solid({ r: 0, g: 1, b: 0, a: 1 })];
  const dot = createNode('ellipse', { parentId: inner.id, order: 'a', name: 'Dot', transform: [1, 0, 0, 1, 10, 20], width: 40, height: 40 });
  inner.motion = { notes: 'slides in from the left' };
  ed.transact('Add', () => [{ t: 'add', node: inner }, { t: 'add', node: dot }]);
  const { text, report } = exportPbc(ed.doc, ed.pageId);
  const { project } = JSON.parse(text);
  // Three boards first (comp 1 is still the first board), then the precomp.
  assert.deepEqual(Object.keys(project.comps), ['1', '2', '3', '4']);
  const layer = project.comps['1'].root.children.at(-1);
  assert.equal(layer.name, 'Window');
  assert.equal(layer.precomp, 4);
  assert.deepEqual(layer.transform.position.Const, { x: 100, y: 50, z: 0 });
  assert.deepEqual(layer.mask.shape.Vector.path.anchors.map((a: { point: { Const: object } }) => a.point.Const), [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 }]);
  assert.deepEqual(layer.tags, ['note: slides in from the left']);
  const comp = project.comps['4'];
  assert.equal(comp.width, 300);
  assert.equal(comp.bg.a, 0);
  assert.deepEqual(comp.root.children.map((c: { name: string }) => c.name), ['Window background', 'Dot']);
  assert.deepEqual(comp.root.children[1].transform.position.Const, { x: 30, y: 40, z: 0 });
  assert.ok(!report.some(r => r.includes('Window')));
});

test('a group with a blend mode becomes a precomp; a plain one stays a group', () => {
  const ed = new Editor(starterDoc());
  const frame = ed.doc.children(ed.pageId)[0]!;
  ed.select([ed.doc.children(frame.id)[0]!.id]); // Card, 600×600 at (240, 375)
  ed.group();
  const g = ed.selection[0]!;
  let layer = JSON.parse(exportPbc(ed.doc, ed.pageId).text).project.comps['1'].root.children[0];
  assert.equal(layer.precomp, undefined);

  ed.setProp([g], 'blendMode', 'multiply');
  const { text, report } = exportPbc(ed.doc, ed.pageId);
  const { project } = JSON.parse(text);
  layer = project.comps['1'].root.children[0];
  assert.equal(layer.blend, 'Multiply');
  const comp = project.comps[String(layer.precomp)];
  assert.equal(comp.width, 600);
  // The comp starts at the group's bounds; the card sits at its centre inside it.
  assert.deepEqual(layer.transform.position.Const, { x: 240, y: 375, z: 0 });
  const card = comp.root.children[0];
  const shift = comp.root.transform.position.Const;
  assert.deepEqual({ x: card.transform.position.Const.x + shift.x, y: card.transform.position.Const.y + shift.y }, { x: 300, y: 300 });
  assert.ok(!report.some(r => r.includes('Group')));

  // An explicit Layer group role keeps it a group, with the note in the report.
  ed.setProp([g], 'motion', { role: 'layer' });
  const r2 = exportPbc(ed.doc, ed.pageId);
  assert.equal(JSON.parse(r2.text).project.comps['1'].root.children[0].precomp, undefined);
  assert.ok(r2.report.some(r => r.includes('Precomp')));
});

test('polygons, stars and lines become Vector paths at the node origin', () => {
  const ed = new Editor(starterDoc());
  const board = ed.doc.children(ed.pageId)[0]!;
  const star = createNode('star', { parentId: board.id, order: 'y', name: 'Star', transform: [1, 0, 0, 1, 10, 20], width: 100, height: 100 });
  const line = createNode('line', { parentId: board.id, order: 'z', name: 'Line', transform: [0, 1, -1, 0, 5, 5], width: 50, height: 0 });
  ed.transact('Add', () => [{ t: 'add', node: star }, { t: 'add', node: line }]);
  const { text, report } = exportPbc(ed.doc, ed.pageId);
  const kids = JSON.parse(text).project.comps['1'].root.children;
  const s = kids.find((c: { name: string }) => c.name === 'Star');
  assert.deepEqual(s.transform.position.Const, { x: 10, y: 20, z: 0 });
  assert.equal(s.shape.Vector.path.anchors.length, 10);
  assert.deepEqual(s.shape.Vector.path.anchors[0].point.Const, { x: 50, y: 0 });
  const l = kids.find((c: { name: string }) => c.name === 'Line');
  assert.equal(l.shape.Vector.path.closed, false);
  assert.deepEqual(l.shape.Vector.path.anchors[1].point.Const, { x: 50, y: 0 });
  assert.equal(l.fill, null);
  assert.ok(l.stroke);
  assert.ok(!report.some(r => r.includes('Star') || r.includes('Line')));
});

test('combining shapes makes a boolean layer with the bottom look; PBC gets a compound path', () => {
  const ed = new Editor(starterDoc());
  const board = ed.doc.children(ed.pageId)[0]!;
  const a = createNode('rect', { parentId: board.id, order: 'y', name: 'A', transform: [1, 0, 0, 1, 0, 0], width: 100, height: 100 });
  a.fills = [solid({ r: 1, g: 0, b: 0, a: 1 })];
  const b = createNode('ellipse', { parentId: board.id, order: 'z', name: 'B', transform: [1, 0, 0, 1, 50, 50], width: 100, height: 100 });
  ed.transact('Add', () => [{ t: 'add', node: a }, { t: 'add', node: b }]);
  ed.select([a.id, b.id]);
  ed.combine('subtract');
  const bool = ed.doc.get(ed.selection[0]!)!;
  assert.equal(bool.type, 'boolean');
  assert.equal(bool.booleanOp, 'subtract');
  assert.deepEqual(bool.fills, a.fills);
  assert.deepEqual(ed.doc.children(bool.id).map(n => n.name), ['A', 'B']);
  const { text, report } = exportPbc(ed.doc, ed.pageId);
  const layer = JSON.parse(text).project.comps['1'].root.children.at(-1);
  assert.equal(layer.compound, 'Subtract');
  assert.deepEqual(layer.fill.Const, { r: 1, g: 0, b: 0, a: 1 });
  assert.deepEqual(layer.children.map((c: { name: string }) => c.name), ['A', 'B']);
  assert.ok(!report.some(r => r.includes('Subtract')));
  ed.undo();
  assert.equal(ed.doc.get(a.id)!.parentId, board.id);
});

test('a mask group (top layer masks) exports as its content in a precomp, matted by the mask right above it', () => {
  const ed = new Editor(starterDoc());
  const board = ed.doc.children(ed.pageId)[0]!;
  const m = createNode('ellipse', { parentId: board.id, order: 'z', name: 'Circle', transform: [1, 0, 0, 1, 0, 0], width: 100, height: 100 });
  const pic = createNode('rect', { parentId: board.id, order: 'y', name: 'Photo', transform: [1, 0, 0, 1, 20, 20], width: 200, height: 200 });
  ed.transact('Add', () => [{ t: 'add', node: m }, { t: 'add', node: pic }]);
  ed.select([m.id, pic.id]);
  ed.mask();
  const g = ed.doc.get(ed.selection[0]!)!;
  assert.equal(g.maskMode, 'alpha');
  ed.setProp([g.id], 'maskMode', 'inverted');
  const { text } = exportPbc(ed.doc, ed.pageId);
  const { project } = JSON.parse(text);
  const layer = project.comps['1'].root.children.at(-1);
  assert.deepEqual(layer.children.map((c: { name: string }) => c.name), ['Mask group content', 'Circle']);
  assert.equal(layer.children[0].matte, 'AlphaInverted');
  const comp = project.comps[String(layer.children[0].precomp)];
  assert.deepEqual(comp.root.children.map((c: { name: string }) => c.name), ['Photo']);
});

test('adjust colors becomes PBC colour effects in order, skipping parts at zero', () => {
  const ed = new Editor(starterDoc());
  const card = ed.doc.children(ed.doc.children(ed.pageId)[0]!.id)[0]!;
  ed.setProp([card.id], 'effects', [{ kind: 'adjust', visible: true, exposure: 0.5, brightness: 0, contrast: 0.2, hue: 0, saturation: -0.3, temperature: 0.4 }]);
  const { text, report } = exportPbc(ed.doc, ed.pageId);
  const fx = JSON.parse(text).project.comps['1'].root.children[0].effects;
  assert.deepEqual(fx.map((e: { kind: object }) => Object.keys(e.kind)[0]), ['Exposure', 'BrightnessContrast', 'HueSaturation', 'PhotoFilter']);
  assert.equal(fx[3].kind.PhotoFilter.density.Const, 0.4);
  assert.ok(!report.some(r => r.includes('adjust')));
});
