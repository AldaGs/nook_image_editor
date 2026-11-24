// Shape tools (rect, ellipse, polygon, star, line, frame): drag to draw, or tap
// for a default size. A line runs from where the drag starts to where it ends.
// New shapes go inside the frame under the pointer. Afterwards the select tool
// comes back with the new shape selected.

import { multiply, rotation, translation, type Point } from '../../geom/affine.ts';
import { createNode, newId } from '../../doc/factory.ts';
import type { NodeType } from '../../doc/types.ts';
import { localFor } from '../bounds.ts';
import { frameAt } from '../hit.ts';
import { dragThreshold, type PointerInfo, type Tool, type ToolContext } from './tool.ts';

/** Default size on tap, in CSS px on screen (so it's always a usable size). */
const TAP_SIZE = 120;

type ShapeType = Extract<NodeType, 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'frame'>;

export class ShapeTool implements Tool {
  private start: PointerInfo | null = null;
  private parentId: string | null = null;
  private id = '';
  private dragging = false;

  private ctx: ToolContext;
  private type: ShapeType;

  constructor(ctx: ToolContext, type: ShapeType) {
    this.ctx = ctx;
    this.type = type;
  }

  down(p: PointerInfo): void {
    const { editor } = this.ctx;
    this.start = p;
    this.dragging = false;
    this.id = newId();
    this.parentId = frameAt(editor.doc, editor.pageId, p.world)?.id ?? editor.pageId;
    editor.history.begin(`Add ${this.type}`);
  }

  move(p: PointerInfo): void {
    const s = this.start;
    if (!s) return;
    if (!this.dragging && Math.hypot(p.screen.x - s.screen.x, p.screen.y - s.screen.y) < dragThreshold(p)) return;
    this.dragging = true;
    const { editor, camera } = this.ctx;
    const end = p.shift ? p.world : editor.snapWorldPoint(p.world, { zoom: camera.zoom, touch: p.touch, alt: p.alt, skip: [this.id] });
    let w = end.x - s.world.x, h = end.y - s.world.y;
    if (this.type === 'line') {
      if (p.shift) { // snap to 45°
        const a = Math.round(Math.atan2(h, w) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(w, h);
        w = len * Math.cos(a); h = len * Math.sin(a);
      }
      this.ctx.editor.history.rewind();
      this.placeLine(s.world, w, h);
      return;
    }
    if (p.shift) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
    this.ctx.editor.history.rewind();
    this.place({ x: Math.min(s.world.x, s.world.x + w), y: Math.min(s.world.y, s.world.y + h) }, Math.abs(w), Math.abs(h));
  }

  up(p: PointerInfo): void {
    const { editor, camera } = this.ctx;
    if (!this.start) return;
    if (!this.dragging) {
      const size = Math.round(TAP_SIZE / camera.zoom);
      if (this.type === 'line') this.placeLine({ x: p.world.x - size / 2, y: p.world.y }, size, 0);
      else this.place({ x: p.world.x - size / 2, y: p.world.y - size / 2 }, size, size);
    }
    editor.history.commit();
    editor.guides = [];
    this.start = null;
    if (editor.doc.get(this.id)) editor.select([this.id]);
    editor.setTool('select');
  }

  cancel(): void {
    this.ctx.editor.history.cancel();
    this.ctx.editor.guides = [];
    this.start = null;
  }

  /** A line from `at` by (dx, dy): its box is the length, rotated to point that way. */
  private placeLine(at: Point, dx: number, dy: number): void {
    const { editor } = this.ctx;
    const parentId = this.parentId!;
    const node = createNode('line', {
      id: this.id,
      parentId,
      order: editor.orderAtTop(parentId),
      transform: localFor(editor.doc, multiply(translation(at.x, at.y), rotation(Math.atan2(dy, dx))), parentId),
      width: Math.max(1, Math.round(Math.hypot(dx, dy))),
      height: 0,
    });
    editor.transact('Add line', () => [{ t: 'add', node }]);
  }

  /** Add the shape at a world-space rect (axis-aligned on screen). */
  private place(at: Point, width: number, height: number): void {
    const { editor } = this.ctx;
    const parentId = this.parentId!;
    const node = createNode(this.type, {
      id: this.id,
      parentId,
      order: editor.orderAtTop(parentId),
      transform: localFor(editor.doc, translation(at.x, at.y), parentId),
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    });
    editor.transact(`Add ${this.type}`, () => [{ t: 'add', node }]);
  }
}
