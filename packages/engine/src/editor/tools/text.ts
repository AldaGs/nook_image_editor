// Text tool: tap for a text box that grows with what you type, or drag out a
// width to wrap at. New text goes in the frame under the pointer, at a size that
// reads well at the current zoom, then the select tool comes back with it selected.

import { translation } from '../../geom/affine.ts';
import { createNode } from '../../doc/factory.ts';
import { localFor } from '../bounds.ts';
import { frameAt } from '../hit.ts';
import { dragThreshold, type PointerInfo, type Tool, type ToolContext } from './tool.ts';

/** Default text size, in CSS px on screen. */
const SCREEN_SIZE = 28;

export class TextTool implements Tool {
  private start: PointerInfo | null = null;
  private ctx: ToolContext;

  constructor(ctx: ToolContext) { this.ctx = ctx; }

  cursor(): string { return 'text'; }

  down(p: PointerInfo): void { this.start = p; }

  move(): void {}

  up(p: PointerInfo): void {
    const { editor, camera } = this.ctx;
    const s = this.start;
    this.start = null;
    if (!s) return;
    const dragged = Math.hypot(p.screen.x - s.screen.x, p.screen.y - s.screen.y) >= dragThreshold(p);
    const at = { x: Math.min(s.world.x, p.world.x), y: dragged ? Math.min(s.world.y, p.world.y) : s.world.y };
    const parentId = frameAt(editor.doc, editor.pageId, s.world)?.id ?? editor.pageId;
    const size = Math.max(1, Math.round(SCREEN_SIZE / camera.zoom));

    const node = createNode('text', {
      parentId, order: editor.orderAtTop(parentId),
      transform: localFor(editor.doc, translation(at.x, at.y), parentId),
    });
    node.text = { ...node.text!, size, sizing: dragged ? 'autoHeight' : 'autoWidth' };
    node.width = dragged ? Math.max(1, Math.abs(p.world.x - s.world.x)) : 0;
    Object.assign(node, editor.textBox(node.text, node.width));
    node.name = node.text.content;

    editor.transact('Add text', () => [{ t: 'add', node }]);
    editor.setTool('select');
    editor.startTextEdit(node.id); // placeholder selected, so typing replaces it
  }

  cancel(): void { this.start = null; }
}
