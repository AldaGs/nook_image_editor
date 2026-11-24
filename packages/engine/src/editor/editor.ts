// Editor: the document plus everything the user is doing to it (selection,
// active tool, undo). Every edit here is one undo step. No DOM or canvas code,
// so it runs (and is tested) in Node.

import { Doc } from '../doc/document.ts';
import { History } from '../doc/history.ts';
import { keyBetween, keysAfter } from '../doc/fractional.ts';
import { createNode, type FramePreset } from '../doc/factory.ts';
import { starterDoc } from '../doc/serialize.ts';
import type { Op } from '../doc/ops.ts';
import type { Node, NodeProp } from '../doc/types.ts';
import { applyVector, invert, translation, type Rect } from '../geom/affine.ts';
import { localFor, worldBounds } from './bounds.ts';

export type ToolId = 'select' | 'rect' | 'ellipse' | 'frame';

/** What the UI needs to render toolbars and panels. */
export interface EditorState {
  version: number;
  selection: string[];
  tool: ToolId;
  multiSelect: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export class Editor {
  doc!: Doc;
  history!: History;
  pageId!: string;
  selection: string[] = [];
  tool: ToolId = 'select';
  /** Touch has no Shift key: in this mode taps add to the selection and one-finger drags draw a marquee. */
  multiSelect = false;
  /** World-space marquee while one is being dragged (drawn by the renderer). */
  marquee: Rect | null = null;

  private listeners = new Set<(s: EditorState) => void>();

  constructor(doc: Doc = starterDoc()) {
    this.load(doc);
  }

  /** Replace the document (open a file). Clears history and selection. */
  load(doc: Doc): void {
    this.doc = doc;
    this.history = new History(doc, () => this.changed());
    const page = doc.children(null).find(n => n.type === 'page');
    if (!page) throw new Error('document has no page');
    this.pageId = page.id;
    this.selection = [];
    this.emit();
  }

  // ── Subscriptions ────────────────────────────────────────────

  get state(): EditorState {
    return {
      version: this.doc.version,
      selection: [...this.selection],
      tool: this.tool,
      multiSelect: this.multiSelect,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    };
  }

  subscribe(fn: (s: EditorState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => { this.listeners.delete(fn); };
  }

  /** Notify listeners (also used by tools for overlay-only changes like the marquee). */
  emit(): void {
    const s = this.state;
    this.listeners.forEach(f => f(s));
  }

  private changed(): void {
    // Drop selected ids that an undo or delete removed.
    this.selection = this.selection.filter(id => this.doc.nodes.has(id));
    this.emit();
  }

  // ── Tool and modes ───────────────────────────────────────────

  setTool(tool: ToolId): void { this.tool = tool; this.emit(); }
  setMultiSelect(on: boolean): void { this.multiSelect = on; this.emit(); }

  // ── Selection ────────────────────────────────────────────────

  select(ids: string[]): void { this.selection = [...new Set(ids)]; this.emit(); }
  toggleSelected(id: string): void {
    this.select(this.selection.includes(id) ? this.selection.filter(s => s !== id) : [...this.selection, id]);
  }
  selectedNodes(): Node[] {
    return this.selection.map(id => this.doc.get(id)).filter((n): n is Node => !!n);
  }

  // ── Edits (each is one undo step) ────────────────────────────

  undo(): void { this.history.undo(); }
  redo(): void { this.history.redo(); }

  /** Set one property on several nodes as a single step. */
  setProp(ids: string[], prop: NodeProp, value: unknown, label = 'Edit'): void {
    this.transact(label, () => ids.map(id => ({ t: 'set', id, prop, value }) as Op));
  }

  rename(id: string, name: string): void {
    if (name.trim()) this.setProp([id], 'name', name.trim(), 'Rename');
  }

  /** Add a frame from a preset to the right of the existing boards, and select it. */
  addFrame(preset: FramePreset): Node {
    const boards = this.doc.children(this.pageId).filter(n => n.type === 'frame');
    const right = worldBounds(this.doc, boards);
    const x = right ? right.x + right.width + 120 : 0;
    const y = right ? right.y : 0;
    const frame = createNode('frame', {
      name: preset.name, parentId: this.pageId, order: this.orderAtTop(this.pageId),
      transform: translation(x, y), width: preset.width, height: preset.height,
    });
    this.transact('Add frame', () => [{ t: 'add', node: frame }]);
    this.select([frame.id]);
    return frame;
  }

  /** Delete the selection and everything inside it. */
  deleteSelection(): void {
    const roots = this.topmostSelected();
    if (!roots.length) return;
    this.transact('Delete', () =>
      roots.flatMap(n => [...this.doc.descendants(n.id).reverse(), n].map(d => ({ t: 'remove', id: d.id }) as Op)),
    );
    this.select([]);
  }

  /** Move a node one step toward the front (+1) or back (-1) among its siblings. */
  reorder(id: string, step: 1 | -1): void {
    const node = this.doc.get(id);
    if (!node) return;
    const sibs = this.doc.children(node.parentId);
    const i = sibs.indexOf(node);
    const j = i + step;
    if (j < 0 || j >= sibs.length) return;
    // New key between the neighbour we pass and the one after it.
    const order = step > 0
      ? keyBetween(sibs[j]!.order, sibs[j + 1]?.order ?? null)
      : keyBetween(sibs[j - 1]?.order ?? null, sibs[j]!.order);
    this.setProp([id], 'order', order, 'Reorder');
  }

  /** Wrap the selection in a group, under the parent of the topmost selected node. */
  group(): void {
    const nodes = this.inDrawOrder(this.topmostSelected()).filter(n => n.type !== 'page');
    if (!nodes.length) return;
    const top = nodes[nodes.length - 1]!;
    const parentId = top.parentId;
    const sibs = this.doc.children(parentId);
    const after = sibs[sibs.indexOf(top) + 1];
    const group = createNode('group', { name: 'Group', parentId, order: keyBetween(top.order, after?.order ?? null), width: 0, height: 0 });
    const orders = keysAfter(null, nodes.length);
    // Two steps in one undo entry: reparent maths needs the group to exist first.
    this.history.begin('Group');
    this.transact('Group', () => [{ t: 'add', node: group }]);
    this.transact('Group', () => nodes.flatMap((n, i) => this.reparentOps(n, group.id, orders[i]!)));
    this.history.commit();
    this.select([group.id]);
  }

  /** Dissolve selected groups, keeping their children where they are on screen. */
  ungroup(): void {
    const groups = this.selectedNodes().filter(n => n.type === 'group');
    if (!groups.length) return;
    const freed: string[] = [];
    this.transact('Ungroup', () => groups.flatMap(g => {
      const kids = this.doc.children(g.id);
      const sibs = this.doc.children(g.parentId);
      const next = sibs[sibs.indexOf(g) + 1];
      let prev = g.order;
      const ops: Op[] = kids.flatMap(k => {
        prev = keyBetween(prev, next?.order ?? null);
        freed.push(k.id);
        return this.reparentOps(k, g.parentId, prev);
      });
      return [...ops, { t: 'remove', id: g.id } as Op];
    }));
    this.select(freed);
  }

  // ── Helpers used by tools ────────────────────────────────────

  /** Run `build` inside one undo step. Ops are applied in order as they are returned. */
  transact(label: string, build: () => Op[]): void {
    const nested = this.history.inTransaction;
    this.history.begin(label);
    try {
      for (const op of build()) this.history.apply(op);
    } catch (e) {
      if (!nested) this.history.cancel();
      throw e;
    }
    if (!nested) this.history.commit();
  }

  /** Ops that move a node under a new parent without moving it on screen. */
  reparentOps(node: Node, parentId: string | null, order: string): Op[] {
    const world = this.doc.worldTransform(node.id);
    // Compute the new local transform before the parent changes.
    const local = localFor(this.doc, world, parentId);
    return [
      { t: 'set', id: node.id, prop: 'parentId', value: parentId },
      { t: 'set', id: node.id, prop: 'order', value: order },
      { t: 'set', id: node.id, prop: 'transform', value: local },
    ];
  }

  /** Order key that places a new child on top of its siblings. */
  orderAtTop(parentId: string): string {
    const sibs = this.doc.children(parentId);
    return keyBetween(sibs[sibs.length - 1]?.order ?? null, null);
  }

  /** Selected nodes, minus those whose ancestor is also selected. */
  topmostSelected(): Node[] {
    const sel = new Set(this.selection);
    return this.selectedNodes().filter(n => !this.doc.ancestors(n.id).some(a => sel.has(a.id)));
  }

  /** Sort nodes back-to-front as they are drawn. */
  inDrawOrder(nodes: Node[]): Node[] {
    const rank = new Map<string, number>();
    this.doc.descendants(this.pageId).forEach((n, i) => rank.set(n.id, i));
    return [...nodes].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  }

  /** Translate nodes by a world-space delta (each in its own parent space). */
  moveOps(nodes: Node[], start: Map<string, Node['transform']>, dx: number, dy: number): Op[] {
    return nodes.map(n => {
      const t0 = start.get(n.id)!;
      // World delta → parent delta through the inverse of the parent's transform.
      const d = n.parentId ? applyVector(invert(this.doc.worldTransform(n.parentId)), { x: dx, y: dy }) : { x: dx, y: dy };
      return { t: 'set', id: n.id, prop: 'transform', value: [t0[0], t0[1], t0[2], t0[3], t0[4] + d.x, t0[5] + d.y] } as Op;
    });
  }
}
