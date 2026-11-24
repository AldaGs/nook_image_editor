import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor, linear, solid, starterDoc } from '@nook/engine';
import { createNode } from '../../engine/src/doc/factory.ts';
import { exportSvg, pathData } from './svg.ts';

test('path data: lines as L, curves as C, closed with Z', () => {
  const d = pathData([{ closed: true, anchors: [
    { p: { x: 0, y: 0 }, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } },
    { p: { x: 10, y: 0 }, in: { x: 0, y: 0 }, out: { x: 0, y: 5 } },
    { p: { x: 10, y: 10 }, in: { x: 0, y: -5 }, out: { x: 0, y: 0 } },
  ] }]);
  assert.equal(d, 'M0 0L10 0C10 5 10 5 10 10L0 0Z');
});

test('a board becomes an SVG of its size with shapes, gradients, strokes and text', () => {
  const ed = new Editor(starterDoc());
  const board = ed.doc.children(ed.pageId)[0]!;
  const star = createNode('star', { parentId: board.id, order: 'y', name: 'Star <1>', transform: [1, 0, 0, 1, 10, 20], width: 100, height: 100 });
  star.fills = [linear({ r: 1, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 1, a: 1 })];
  star.strokes = [{ paint: solid({ r: 0, g: 0, b: 0, a: 1 }), width: 4, align: 'inside' }];
  const t = createNode('text', { parentId: board.id, order: 'z', name: 'T', transform: [1, 0, 0, 1, 0, 300], width: 200, height: 60 });
  t.text!.content = 'Hi & bye';
  ed.transact('Add', () => [{ t: 'add', node: star }, { t: 'add', node: t }]);
  const { text, report } = exportSvg(ed.doc, board.id);
  assert.match(text, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1080" height="1350"/);
  assert.match(text, /data-name="Star &lt;1&gt;" transform="matrix\(1 0 0 1 10 20\)"/);
  assert.match(text, /<linearGradient id="g\d+" x1="0.5" y1="0" x2="0.5" y2="1">/);
  assert.match(text, /stroke-width="8"/);            // inside: double width, clipped
  assert.match(text, /<clipPath id="c\d+"><path d="M50 0/);
  assert.match(text, /<tspan x="0" y="[\d.]+">Hi &amp; bye<\/tspan>/);
  assert.ok(report.some(r => r.includes('fonts')));
});

test('booleans use the outline the engine gives, with their fill rule', () => {
  const ed = new Editor(starterDoc());
  const board = ed.doc.children(ed.pageId)[0]!;
  const a = createNode('rect', { parentId: board.id, order: 'y', name: 'A', width: 10, height: 10 });
  const b = createNode('rect', { parentId: board.id, order: 'z', name: 'B', width: 10, height: 10 });
  ed.transact('Add', () => [{ t: 'add', node: a }, { t: 'add', node: b }]);
  ed.select([a.id, b.id]);
  ed.combine('exclude');
  const sq = { closed: true, anchors: [[0, 0], [5, 0], [5, 5]].map(([x, y]) => ({ p: { x: x!, y: y! }, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } })) };
  const { text } = exportSvg(ed.doc, board.id, { outline: () => ({ contours: [sq], fillRule: 'evenodd' }) });
  assert.match(text, /<path d="M0 0L5 0L5 5L0 0Z" fill-rule="evenodd" fill="rgb/);
  assert.doesNotMatch(text, /data-name="A"/); // the merged outline, not the shapes
});
