// Editor: the document plus everything the user is doing to it (selection,
// active tool, undo). Every edit here is one undo step. No DOM or canvas code,
// so it runs (and is tested) in Node.

import { Doc } from '../doc/document.ts';
import { History } from '../doc/history.ts';
import { keyBetween, keysAfter } from '../doc/fractional.ts';
import { createNode, type FramePreset } from '../doc/factory.ts';
import { starterDoc } from '../doc/serialize.ts';
import type { Op } from '../doc/ops.ts';
import type { GradientPaint, Node, NodeProp } from '../doc/types.ts';
import { applyVector, invert, multiply, rotation, translation, type Affine, type Point, type Rect } from '../geom/affine.ts';
import { localFor, worldBounds } from './bounds.ts';
import { frameAt } from './hit.ts';
import type { Guide } from './snap.ts';

export type ToolId = 'select' | 'rect' | 'ellipse' | 'frame';

/** One paint on a node: a fill, or a stroke's paint. */
export interface GradientTarget { nodeId: string; prop: 'fills' | 'strokes'; index: number }

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
  /** The gradient whose end points are being dragged on the canvas, if any. */
  gradientEdit: GradientTarget | null = null;
  /** World-space snap guides while a move is snapping (drawn by the renderer). */
  guides: Guide[] = [];

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
    if (this.gradientEdit && !this.gradientPaint(this.gradientEdit)) this.gradientEdit = null;
    this.emit();
  }

  // ── Tool and modes ───────────────────────────────────────────

  setTool(tool: ToolId): void { this.tool = tool; this.emit(); }
  setMultiSelect(on: boolean): void { this.multiSelect = on; this.emit(); }

  // ── Selection ────────────────────────────────────────────────

  select(ids: string[]): void {
    this.selection = [...new Set(ids)];
    if (this.gradientEdit && !this.selection.includes(this.gradientEdit.nodeId)) this.gradientEdit = null;
    this.emit();
  }

  // ── Gradient handles ─────────────────────────────────────────

  /** Show (or with null, hide) a gradient's end points on the canvas. */
  editGradient(target: GradientTarget | null): void {
    this.gradientEdit = target && this.gradientPaint(target) ? target : null;
    this.emit();
  }

  /** The gradient a target points at, or null when it is not a gradient (any more). */
  gradientPaint(t: GradientTarget): GradientPaint | null {
    const n = this.doc.get(t.nodeId);
    const p = t.prop === 'fills' ? n?.fills[t.index] : n?.strokes[t.index]?.paint;
    return p && p.kind !== 'solid' ? p : null;
  }

  /** Ops that replace the target's paint. */
  setGradientOps(t: GradientTarget, paint: GradientPaint): Op[] {
    const n = this.doc.get(t.nodeId)!;
    const value = t.prop === 'fills'
      ? n.fills.map((f, i) => (i === t.index ? paint : f))
      : n.strokes.map((s, i) => (i === t.index ? { ...s, paint } : s));
    return [{ t: 'set', id: n.id, prop: t.prop, value }];
  }
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

  /**
   * A change the user is still refining (a slider drag, picking a colour):
   * each call replaces the previous one, and `commitEdit()` makes the whole
   * gesture one undo step.
   */
  preview(ids: string[], prop: NodeProp, value: unknown, label = 'Edit'): void {
    this.history.begin(label);
    this.history.rewind();
    this.setProp(ids, prop, value, label);
  }

  commitEdit(): void { this.history.commit(); }

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

  /**
   * After a move: nodes sitting directly in a frame or on the page go into the
   * deepest frame under `p` (or back onto the page), on top, keeping their
   * place on screen. Children of groups and boards themselves stay put.
   */
  dropAt(nodes: Node[], p: Point): void {
    const moving = new Set(nodes.flatMap(n => [n.id, ...this.doc.descendants(n.id).map(d => d.id)]));
    const target = frameAt(this.doc, this.pageId, p, moving)?.id ?? this.pageId;
    const movers = this.inDrawOrder(nodes.map(n => this.doc.get(n.id)!).filter(n => {
      if (n.type === 'frame' || n.parentId === target) return false;
      const parent = n.parentId ? this.doc.get(n.parentId) : null;
      return parent?.type === 'frame' || parent?.type === 'page';
    }));
    if (!movers.length) return;
    const sibs = this.doc.children(target);
    const orders = keysAfter(sibs[sibs.length - 1]?.order ?? null, movers.length);
    this.transact('Move', () => movers.flatMap((n, i) => this.reparentOps(n, target, orders[i]!)));
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

  /**
   * Stretch nodes from box `from` to box `to`, both in the space `toWorld` maps
   * to world. Groups pass through to their contents; every other node keeps a
   * plain rotation + translation and changes its width and height instead, so
   * nothing ends up with a scaled transform (PBC export needs real sizes).
   */
  scaleOps(nodes: Node[], toWorld: Affine, from: Rect, to: Rect): Op[] {
    const sx = from.width ? to.width / from.width : 1, sy = from.height ? to.height / from.height : 1;
    const inBox: Affine = [sx, 0, 0, sy, to.x - from.x * sx, to.y - from.y * sy];
    const m = multiply(toWorld, multiply(inBox, invert(toWorld)));
    const leaves = (n: Node): Node[] => n.type === 'group' ? this.doc.children(n.id).flatMap(leaves) : [n];
    return nodes.flatMap(leaves).flatMap(n => {
      const w = multiply(m, this.doc.worldTransform(n.id));
      // ponytail: a rotated node under a non-uniform stretch would shear; it keeps its own angle and stretches along its own axes (as Figma does).
      const world = multiply(translation(w[4], w[5]), rotation(Math.atan2(w[1], w[0])));
      const r = (v: number) => Math.round(v * 100) / 100;
      return [
        { t: 'set', id: n.id, prop: 'transform', value: localFor(this.doc, world, n.parentId) },
        { t: 'set', id: n.id, prop: 'width', value: r(n.width * Math.hypot(w[0], w[1])) },
        { t: 'set', id: n.id, prop: 'height', value: r(n.height * Math.hypot(w[2], w[3])) },
      ] as Op[];
    });
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
