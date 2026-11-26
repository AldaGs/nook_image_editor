// Editor: the document plus everything the user is doing to it (selection,
// active tool, undo). Every edit here is one undo step. No DOM or canvas code,
// so it runs (and is tested) in Node.

import { Doc } from '../doc/document.ts';
import { History } from '../doc/history.ts';
import { keyBetween, keysAfter } from '../doc/fractional.ts';
import { createNode, newId } from '../doc/factory.ts';
import { contoursBounds, scalePath, shapePath, shiftPath, type Anchor, type VectorPath } from '../doc/shapes.ts';
import { splitAt } from './tools/points.ts';
import { starterDoc } from '../doc/serialize.ts';
import type { Op } from '../doc/ops.ts';
import { isContainer, isGradient, type BooleanOp, type GradientPaint, type ImagePaint, type Node, type NodeProp, type Paint, type Stroke, type TextProps } from '../doc/types.ts';
import { applyVector, invert, multiply, rotation, translation, type Affine, type Point, type Rect } from '../geom/affine.ts';
import { localFor, worldBounds } from './bounds.ts';
import { boxPoints, snapPoint } from './snap.ts';
import { frameAt } from './hit.ts';
import type { Guide } from './snap.ts';

/** One shape for addVectors: its contours and look. */
export interface VectorShape { name: string; contours: VectorPath[]; fillRule: 'nonzero' | 'evenodd'; fills: Paint[]; strokes: Stroke[]; opacity: number }

export type ToolId = 'select' | 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'pen' | 'frame' | 'text';

/** Text layout as the renderer measures it: the box the text needs. */
export type MeasureText = (text: TextProps, width: number | null) => { width: number; height: number };

/** Before fonts load (and in tests): a rough guess from character counts. */
export const estimateText: MeasureText = (t, width) => {
  const line = t.lineHeight ?? t.size * 1.2;
  const lines = t.content.split('\n');
  const longest = Math.max(1, ...lines.map(l => l.length));
  const w = longest * (t.size * 0.55 + t.letterSpacing);
  const wrapped = width ? lines.reduce((sum, l) => sum + Math.max(1, Math.ceil((l.length * (t.size * 0.55 + t.letterSpacing)) / width)), 0) : lines.length;
  return { width: width ?? w, height: wrapped * line };
};

/** The text being typed into, and its selection (UTF-16 offsets, like a <textarea>). */
export interface TextEdit { nodeId: string; start: number; end: number }

/** One paint on a node: a fill, or a stroke's paint. */
export interface GradientTarget { nodeId: string; prop: 'fills' | 'strokes'; index: number }

/** What the UI needs to render toolbars and panels. */
export interface EditorState {
  version: number;
  selection: string[];
  tool: ToolId;
  multiSelect: boolean;
  safeZones: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Points in the path the pen is drawing (0 when none). */
  penPoints: number;
  /** Point editing: the selected point, if any, and whether it is smooth / split. */
  pointEdit: { anchor: number | null; smooth: boolean; split: boolean } | null;
}

export class Editor {
  doc!: Doc;
  history!: History;
  pageId!: string;
  selection: string[] = [];
  tool: ToolId = 'select';
  /** Touch has no Shift key: in this mode taps add to the selection and one-finger drags draw a marquee. */
  multiSelect = false;
  /** Shade the parts of story-shaped boards that social apps cover with their UI. */
  safeZones = false;
  /** How strongly the safe zones are shaded, 0–1. */
  safeZoneOpacity = 0.18;
  /** World-space marquee while one is being dragged (drawn by the renderer). */
  marquee: Rect | null = null;
  /** The text layer being edited on the canvas, if any. */
  textEdit: TextEdit | null = null;
  /**
   * Called synchronously when editing starts or the canvas moves the caret, so
   * the UI can focus its hidden <textarea> inside the tap (iOS only opens the
   * keyboard for a focus that happens during a user gesture).
   */
  onTextEdit: ((e: TextEdit, content: string) => void) | null = null;
  private textSession = 0;
  /** Lays text out; the engine swaps in CanvasKit's measurement once it has loaded. */
  measureText: MeasureText = estimateText;
  /** The gradient whose end points are being dragged on the canvas, if any. */
  gradientEdit: GradientTarget | null = null;
  /**
   * Boxes things can snap to: boards and what's on the page or directly in a
   * board, minus `skip` (and everything inside it).
   */
  snapRects(skip: Iterable<string>): Rect[] {
    const { doc, pageId } = this;
    const gone = new Set<string>();
    for (const id of skip) { gone.add(id); for (const d of doc.descendants(id)) gone.add(d.id); }
    const top = doc.children(pageId);
    const near = [...top, ...top.filter(n => n.type === 'frame').flatMap(f => doc.children(f.id))];
    return near.filter(n => n.visible && !gone.has(n.id)).flatMap(n => worldBounds(doc, [n]) ?? []);
  }

  /**
   * Snap a world point for the pen, point editing and shape drags: to `extra`
   * points (a path's own) and to boxes' corners, edge middles and centres,
   * within 6 screen px (8 for a finger). Sets the guides; Alt turns it off.
   */
  snapWorldPoint(p: Point, opts: { zoom: number; touch: boolean; alt: boolean; skip?: Iterable<string>; extra?: Point[] }): Point {
    if (opts.alt) { this.guides = []; return p; }
    const tol = (opts.touch ? 8 : 6) / opts.zoom;
    const r = snapPoint(p, [...(opts.extra ?? []), ...boxPoints(this.snapRects(opts.skip ?? []))], tol);
    this.guides = r.guides;
    return r.point;
  }

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
    this.textEdit = null;
    this.gradientEdit = null;
    this.emit();
  }

  // ── Subscriptions ────────────────────────────────────────────

  get state(): EditorState {
    return {
      version: this.doc.version,
      selection: [...this.selection],
      tool: this.tool,
      multiSelect: this.multiSelect,
      safeZones: this.safeZones,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      penPoints: this.penNode()?.path?.anchors.length ?? 0,
      pointEdit: this.pointEditState(),
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
    if (this.textEdit && !this.doc.nodes.has(this.textEdit.nodeId)) this.textEdit = null;
    if (this.pointEdit) {
      const n = this.doc.get(this.pointEdit.nodeId);
      if (n?.type !== 'vector' || !n.path) this.pointEdit = null;
      else if (this.pointEdit.anchor !== null && this.pointEdit.anchor >= n.path.anchors.length) this.pointEdit.anchor = null;
    }
    if (this.gradientEdit && !this.gradientPaint(this.gradientEdit)) this.gradientEdit = null;
    this.emit();
  }

  // ── Tool and modes ───────────────────────────────────────────

  setTool(tool: ToolId): void {
    if (this.tool === 'pen' && tool !== 'pen') this.finishPen();
    this.tool = tool;
    this.emit();
  }

  // ── Point editing ────────────────────────────────────────────

  /** The path whose points are being edited, and the selected point. */
  pointEdit: { nodeId: string; anchor: number | null } | null = null;

  private pointEditState(): EditorState['pointEdit'] {
    const pe = this.pointEdit;
    if (!pe) return null;
    const a = pe.anchor !== null ? this.doc.get(pe.nodeId)?.path?.anchors[pe.anchor] : undefined;
    return { anchor: a ? pe.anchor : null, smooth: !!a && isSmooth(a), split: !!a?.split };
  }

  /**
   * Edit a layer's points. Polygons, stars and lines become paths first (one
   * undo step); vectors go straight in.
   */
  editPoints(id: string): void {
    const n = this.doc.get(id);
    if (!n) return;
    if (n.type === 'polygon' || n.type === 'star' || n.type === 'line') {
      const path = shapePath(n)!;
      const vector: Node = { ...n, type: 'vector', path };
      delete vector.pointCount;
      delete vector.innerRatio;
      this.transact('Convert to path', () => [{ t: 'remove', id }, { t: 'add', node: vector }]);
    } else if (n.type !== 'vector') return;
    this.select([id]);
    this.pointEdit = { nodeId: id, anchor: null };
    this.emit();
  }

  endPointEdit(): void {
    if (!this.pointEdit) return;
    this.pointEdit = null;
    this.emit();
  }

  selectPoint(i: number | null): void {
    if (!this.pointEdit) return;
    this.pointEdit.anchor = i;
    this.emit();
  }

  private editedPath(): { n: Node; i: number } | null {
    const pe = this.pointEdit;
    const n = pe ? this.doc.get(pe.nodeId) : undefined;
    if (!pe || pe.anchor === null || n?.type !== 'vector' || !n.path?.anchors[pe.anchor]) return null;
    return { n, i: pe.anchor };
  }

  /** Add a point on the path (from a tap), without changing its shape, and select it. */
  insertPoint(n: Node, at: { seg: number; t: number }): void {
    if (!n.path || at.seg < 0) return;
    const { path, index } = splitAt(n.path, at.seg, at.t);
    this.transact('Add point', () => this.pathOps(n, path));
    this.selectPoint(index);
  }

  deletePoint(): void {
    const e = this.editedPath();
    if (!e) return;
    const anchors = e.n.path!.anchors.filter((_, j) => j !== e.i);
    if (anchors.length < 2) {
      this.pointEdit = null;
      this.transact('Delete path', () => [{ t: 'remove', id: e.n.id }]);
      return;
    }
    this.transact('Delete point', () => this.pathOps(e.n, { ...e.n.path!, anchors, closed: e.n.path!.closed && anchors.length > 2 }));
    this.selectPoint(null);
  }

  /** Corner <-> smooth. A new smooth point's handles run parallel to its neighbours, a sixth of the way between them each side. */
  toggleSmooth(): void {
    const e = this.editedPath();
    if (!e) return;
    const path = e.n.path!, anchors = path.anchors.map(a => ({ ...a })), a = anchors[e.i]!;
    if (isSmooth(a) || a.split) {
      anchors[e.i] = { p: a.p, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } };
    } else {
      const k = anchors.length;
      const prev = anchors[e.i - 1] ?? (path.closed ? anchors[k - 1] : undefined);
      const next = anchors[e.i + 1] ?? (path.closed ? anchors[0] : undefined);
      const from = prev?.p ?? a.p, to = next?.p ?? a.p;
      const out = { x: (to.x - from.x) / 6, y: (to.y - from.y) / 6 };
      anchors[e.i] = { p: a.p, out, in: { x: -out.x, y: -out.y } };
    }
    this.transact('Point type', () => this.pathOps(e.n, { ...path, anchors }));
  }

  /** Let the selected point's handles move on their own (or mirror again). */
  toggleSplit(): void {
    const e = this.editedPath();
    if (!e) return;
    const anchors = e.n.path!.anchors.map((a, j) => (j === e.i ? { ...a, split: !a.split } : a));
    this.transact('Break handles', () => this.pathOps(e.n, { ...e.n.path!, anchors }));
  }

  // ── Pen ──────────────────────────────────────────────────────

  /**
   * The pen's path in progress (a vector node, one undo step per point) and,
   * while a finger is down, the screen point the loupe magnifies.
   */
  pen: { nodeId: string | null; loupe: Point | null } = { nodeId: null, loupe: null };

  penNode(): Node | null {
    const n = this.pen.nodeId ? this.doc.get(this.pen.nodeId) : undefined;
    return n?.type === 'vector' ? n : null;
  }

  /**
   * End the path: closed (joined back to its first point) or left open. A path
   * of one point is removed. The finished path is selected and the pen stays
   * ready for the next one.
   */
  finishPen(close = false): void {
    const n = this.penNode();
    this.pen = { nodeId: null, loupe: null };
    if (n?.path) {
      if (n.path.anchors.length < 2) this.transact('Remove point', () => [{ t: 'remove', id: n.id }]);
      else {
        if (close && !n.path.closed) this.transact('Close path', () => this.pathOps(n, { ...n.path!, closed: true }));
        this.select([n.id]);
      }
    }
    this.emit();
  }
  setMultiSelect(on: boolean): void { this.multiSelect = on; this.emit(); }
  setSafeZones(on: boolean): void { this.safeZones = on; this.emit(); }
  setSafeZoneOpacity(v: number): void { this.safeZoneOpacity = Math.min(1, Math.max(0, v)); this.emit(); }

  // ── Selection ────────────────────────────────────────────────

  select(ids: string[]): void {
    if (this.textEdit && !ids.includes(this.textEdit.nodeId)) this.endTextEdit();
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
    return p && isGradient(p) ? p : null;
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

  // ── Text ─────────────────────────────────────────────────────

  /** The size an auto-sized text box should have, or null for a fixed one. */
  textBox(text: TextProps, width: number): { width: number; height: number } | null {
    if (text.sizing === 'fixed') return null;
    const m = this.measureText(text, text.sizing === 'autoHeight' ? width : null);
    const r = (v: number) => Math.ceil(v * 100) / 100;
    return { width: text.sizing === 'autoWidth' ? r(m.width) : width, height: r(m.height) };
  }

  /** Ops that change a text node's content or style and keep an auto-sized box in step. */
  textOps(n: Node, patch: Partial<TextProps>): Op[] {
    const text = { ...n.text!, ...patch };
    const ops: Op[] = [{ t: 'set', id: n.id, prop: 'text', value: text }];
    const box = this.textBox(text, n.width);
    if (box) ops.push({ t: 'set', id: n.id, prop: 'width', value: box.width }, { t: 'set', id: n.id, prop: 'height', value: box.height });
    return ops;
  }

  /** Change text props on every text node in `ids` (live, like `preview`; then `commitEdit`). */
  previewText(ids: string[], patch: Partial<TextProps>): void {
    this.history.begin('Edit text');
    this.history.rewind();
    const nodes = ids.map(id => this.doc.get(id)).filter((n): n is Node => n?.type === 'text');
    this.transact('Edit text', () => nodes.flatMap(n => this.textOps(n, patch)));
  }

  /** Start typing into a text layer, with the given selection (default: all of it). */
  startTextEdit(id: string, start?: number, end?: number): void {
    const n = this.doc.get(id);
    if (n?.type !== 'text' || !n.text) return;
    if (this.textEdit?.nodeId !== id) this.textSession++;
    const len = n.text.content.length;
    this.textEdit = { nodeId: id, start: start ?? 0, end: end ?? start ?? len };
    this.selection = [id];
    this.onTextEdit?.(this.textEdit, n.text.content);
    this.emit();
  }

  /** New content from the keyboard, and where the selection is now. One undo step per editing session. */
  typeText(content: string, start: number, end: number): void {
    const t = this.textEdit;
    const n = t && this.doc.get(t.nodeId);
    if (!t || !n?.text) return;
    t.start = start;
    t.end = end;
    if (content === n.text.content) return this.emit();
    this.history.begin('Typing');
    this.transact('Typing', () => [
      ...this.textOps(n, { content }),
      { t: 'set', id: n.id, prop: 'name', value: content.trim().split('\n')[0]!.slice(0, 40) || 'Text' } as Op,
    ]);
    this.history.commit(`typing:${this.textSession}`);
  }

  /** Move the caret or selection (from the keyboard, or a tap on the text). */
  setTextSelection(start: number, end: number, fromCanvas = false): void {
    const t = this.textEdit;
    if (!t || (t.start === start && t.end === end)) return;
    t.start = start;
    t.end = end;
    const n = this.doc.get(t.nodeId);
    if (fromCanvas && n?.text) this.onTextEdit?.(t, n.text.content);
    this.emit();
  }

  /** Stop typing. A text layer left empty is removed (its own undo step). */
  endTextEdit(): void {
    const t = this.textEdit;
    if (!t) return;
    this.textEdit = null;
    const n = this.doc.get(t.nodeId);
    if (n?.text && !n.text.content.trim()) {
      this.transact('Delete empty text', () => [{ t: 'remove', id: n.id }]);
      this.selection = this.selection.filter(id => id !== n.id);
    }
    this.emit();
  }

  /**
   * Re-measure auto-sized text after a font arrives. Not an undo step: the
   * size is derived from the text, which is what the user changed.
   */
  refreshTextBoxes(): void {
    let changed = false;
    for (const n of this.doc.nodes.values()) {
      if (n.type !== 'text' || !n.text) continue;
      const box = this.textBox(n.text, n.width);
      if (!box || (Math.abs(box.width - n.width) < 0.5 && Math.abs(box.height - n.height) < 0.5)) continue;
      this.doc.apply({ t: 'set', id: n.id, prop: 'width', value: box.width });
      this.doc.apply({ t: 'set', id: n.id, prop: 'height', value: box.height });
      changed = true;
    }
    if (changed) this.emit();
  }

  rename(id: string, name: string): void {
    if (name.trim()) this.setProp([id], 'name', name.trim(), 'Rename');
  }

  /** Add a frame from a preset to the right of the existing boards, and select it. */
  addFrame(preset: { name: string; width: number; height: number }): Node {
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

  /**
   * Copy a board and everything on it, placed to the right of the existing
   * boards, and select the copy. One undo step.
   */
  duplicateBoard(id: string): Node | null {
    const src = this.doc.get(id);
    if (!src || src.type !== 'frame') return null;
    const boards = this.doc.children(this.pageId).filter(n => n.type === 'frame');
    const right = worldBounds(this.doc, boards)!;
    const t = src.transform;
    const at = worldBounds(this.doc, [src])!;
    const transform: Affine = [t[0], t[1], t[2], t[3], t[4] + right.x + right.width + 120 - at.x, t[5] + right.y - at.y];
    const copy: Node = { ...structuredClone(src), id: newId(), name: `${src.name} copy`, transform, parentId: src.parentId, order: this.orderAtTop(src.parentId ?? this.pageId) };
    const ids = new Map([[src.id, copy.id]]);
    const nodes = [copy, ...this.doc.descendants(src.id).map(d => {
      const n: Node = { ...structuredClone(d), id: newId() };
      ids.set(d.id, n.id);
      return n;
    })];
    for (const n of nodes.slice(1)) n.parentId = ids.get(n.parentId!)!;
    this.transact('Duplicate board', () => nodes.map(node => ({ t: 'add', node }) as Op));
    this.select([copy.id]);
    return copy;
  }

  /**
   * Add a picture as a rectangle with an image fill. On a board it fits inside
   * the board, centred; on the page it keeps its pixel size, centred on `at`.
   */
  addImage(img: { assetId: string; width: number; height: number }, name: string, at: Point): Node {
    const frame = frameAt(this.doc, this.pageId, at);
    const parentId = frame?.id ?? this.pageId;
    let { width, height } = img;
    let x = at.x - width / 2, y = at.y - height / 2;
    if (frame) {
      const s = Math.min(1, frame.width / width, frame.height / height);
      width *= s;
      height *= s;
      x = (frame.width - width) / 2;
      y = (frame.height - height) / 2;
    }
    const fill: ImagePaint = { kind: 'image', ...img, scaleMode: 'fill', opacity: 1, blendMode: 'normal', visible: true };
    const node = createNode('rect', {
      name, parentId, order: this.orderAtTop(parentId), fills: [fill],
      transform: translation(Math.round(x), Math.round(y)), width: Math.round(width), height: Math.round(height),
    });
    this.transact('Add image', () => [{ t: 'add', node }]);
    return node;
  }

  /**
   * Add drawn shapes (contours in one shared space, e.g. a pasted SVG's) as
   * vector layers, grouped when there are several. Placed like addImage: on a
   * board centred and shrunk to fit (strokes too), else centred on `at`.
   */
  addVectors(shapes: VectorShape[], name: string, at: Point): Node | null {
    const all = shapes.filter(s => s.contours.length);
    if (!all.length) return null;
    const B = contoursBounds(all.flatMap(s => s.contours));
    const frame = frameAt(this.doc, this.pageId, at);
    const parentId = frame?.id ?? this.pageId;
    const s = frame ? Math.min(1, frame.width / B.width, frame.height / B.height) : 1;
    const w = B.width * s, h = B.height * s;
    const x = Math.round(frame ? (frame.width - w) / 2 : at.x - w / 2), y = Math.round(frame ? (frame.height - h) / 2 : at.y - h / 2);
    const r = (v: number) => Math.round(v * 100) / 100;
    const group = all.length > 1
      ? createNode('group', { name, parentId, order: this.orderAtTop(parentId), width: 0, height: 0, transform: translation(x, y) })
      : null;
    const orders = keysAfter(null, all.length);
    const nodes = all.map((sh, i) => {
      const cs = sh.contours.map(p => scalePath(shiftPath(p, -B.x, -B.y), s, s));
      const b = contoursBounds(cs);
      const [first, ...rest] = cs.map(p => shiftPath(p, -b.x, -b.y));
      const off = group ? { x: 0, y: 0 } : { x, y };
      return createNode('vector', {
        name: group ? sh.name : name, parentId: group?.id ?? parentId, order: group ? orders[i]! : this.orderAtTop(parentId),
        transform: translation(off.x + r(b.x), off.y + r(b.y)), width: r(b.width), height: r(b.height), opacity: sh.opacity,
        fills: sh.fills, strokes: sh.strokes.map(k => ({ ...k, width: r(k.width * s) })),
        path: first!, ...(rest.length ? { subpaths: rest, fillRule: sh.fillRule } : {}),
      });
    });
    this.transact('Add vectors', () => [...(group ? [group] : []), ...nodes].map(node => ({ t: 'add', node }) as Op));
    const top = group ?? nodes[0]!;
    this.select([top.id]);
    return top;
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
  group(): void { this.wrap('group'); }

  /**
   * Combine the selection into a boolean layer (non-destructive: the shapes stay
   * inside and can still be edited). It takes the bottom shape's look.
   */
  combine(op: BooleanOp = 'union'): void {
    if (this.topmostSelected().length < 2) return;
    this.wrap('boolean', op);
  }

  /**
   * Mask the selection: the top selected layer becomes an alpha mask for the
   * ones below it, inside a new mask group (one undo step). Needs two layers.
   */
  mask(): void {
    if (this.topmostSelected().length < 2) return;
    this.wrap('group', undefined, { maskMode: 'alpha', name: 'Mask group' });
  }

  private wrap(type: 'group' | 'boolean', op?: BooleanOp, extra: Partial<Node> = {}): void {
    const nodes = this.inDrawOrder(this.topmostSelected()).filter(n => n.type !== 'page');
    if (!nodes.length) return;
    const top = nodes[nodes.length - 1]!;
    const parentId = top.parentId;
    const sibs = this.doc.children(parentId);
    const after = sibs[sibs.indexOf(top) + 1];
    const base = nodes[0]!;
    const look = type === 'boolean' ? { booleanOp: op, fills: structuredClone(base.fills), strokes: structuredClone(base.strokes), name: OP_NAMES[op!] } : { name: 'Group' };
    const group = createNode(type, { ...look, ...extra, parentId, order: keyBetween(top.order, after?.order ?? null), width: 0, height: 0 });
    const orders = keysAfter(null, nodes.length);
    // Two steps in one undo entry: reparent maths needs the group to exist first.
    const label = extra.maskMode ? 'Mask' : type === 'group' ? 'Group' : 'Combine';
    this.history.begin(label);
    this.transact(label, () => [{ t: 'add', node: group }]);
    this.transact(label, () => nodes.flatMap((n, i) => this.reparentOps(n, group.id, orders[i]!)));
    this.history.commit();
    this.select([group.id]);
  }

  /** Dissolve selected groups, keeping their children where they are on screen. */
  ungroup(): void {
    const groups = this.selectedNodes().filter(isContainer);
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
    const leaves = (n: Node): Node[] => isContainer(n) ? this.doc.children(n.id).flatMap(leaves) : [n];
    return nodes.flatMap(leaves).flatMap(n => {
      const w = multiply(m, this.doc.worldTransform(n.id));
      // ponytail: a rotated node under a non-uniform stretch would shear; it keeps its own angle and stretches along its own axes (as Figma does).
      const world = multiply(translation(w[4], w[5]), rotation(Math.atan2(w[1], w[0])));
      const r = (v: number) => Math.round(v * 100) / 100;
      const sx = Math.hypot(w[0], w[1]), sy = Math.hypot(w[2], w[3]);
      return [
        ...(n.type === 'vector' && n.path ? [{ t: 'set', id: n.id, prop: 'path', value: scalePath(n.path, sx, sy) } as Op] : []),
        ...(n.type === 'vector' && n.subpaths ? [{ t: 'set', id: n.id, prop: 'subpaths', value: n.subpaths.map(p => scalePath(p, sx, sy)) } as Op] : []),
        ...(n.type === 'text' && n.text && n.text.sizing !== 'fixed' ? [{ t: 'set', id: n.id, prop: 'text', value: { ...n.text, sizing: 'fixed' } } as Op] : []),
        { t: 'set', id: n.id, prop: 'transform', value: localFor(this.doc, world, n.parentId) },
        { t: 'set', id: n.id, prop: 'width', value: r(n.width * Math.hypot(w[0], w[1])) },
        { t: 'set', id: n.id, prop: 'height', value: r(n.height * Math.hypot(w[2], w[3])) },
      ] as Op[];
    });
  }

  /**
   * Set a vector's path (in its current local space) and refit its box to the
   * drawn curve: the path moves to start at 0,0 and the transform moves the
   * other way, so nothing shifts on screen.
   */
  pathOps(n: Node, path: VectorPath): Op[] {
    const b = contoursBounds([path, ...(n.subpaths ?? [])]);
    const r = (v: number) => Math.round(v * 100) / 100;
    return [
      { t: 'set', id: n.id, prop: 'path', value: shiftPath(path, -b.x, -b.y) },
      ...(n.subpaths ? [{ t: 'set', id: n.id, prop: 'subpaths', value: n.subpaths.map(p => shiftPath(p, -b.x, -b.y)) } as Op] : []),
      { t: 'set', id: n.id, prop: 'transform', value: multiply(n.transform, translation(b.x, b.y)) },
      { t: 'set', id: n.id, prop: 'width', value: r(b.width) },
      { t: 'set', id: n.id, prop: 'height', value: r(b.height) },
    ];
  }

  /**
   * Replace a layer with a path of the given contours (in the layer's own
   * space), keeping its place, name and look. Used by flatten.
   */
  replaceWithPath(n: Node, contours: VectorPath[], fillRule: 'nonzero' | 'evenodd'): void {
    if (!contours.length) return;
    const b = contoursBounds(contours);
    const [first, ...rest] = contours.map(p => shiftPath(p, -b.x, -b.y));
    const r = (v: number) => Math.round(v * 100) / 100;
    const vector = createNode('vector', {
      name: n.name, parentId: n.parentId, order: n.order,
      transform: multiply(n.transform, translation(b.x, b.y)),
      width: r(b.width), height: r(b.height),
      visible: n.visible, locked: n.locked, opacity: n.opacity, blendMode: n.blendMode,
      fills: structuredClone(n.fills), strokes: structuredClone(n.strokes), effects: structuredClone(n.effects),
      motion: n.motion, path: first!, ...(rest.length ? { subpaths: rest, fillRule } : {}),
    });
    // Children first (deepest last in the list, so reversed), then the layer, then the path in its place.
    const gone = [...this.doc.descendants(n.id)].reverse();
    this.pointEdit = null;
    this.transact('Flatten', () => [...gone.map(d => ({ t: 'remove', id: d.id }) as Op), { t: 'remove', id: n.id }, { t: 'add', node: vector }]);
    this.select([vector.id]);
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

/** Handles present and mirrored (within rounding). */
function isSmooth(a: Anchor): boolean {
  return (a.out.x !== 0 || a.out.y !== 0) && Math.abs(a.in.x + a.out.x) < 0.01 && Math.abs(a.in.y + a.out.y) < 0.01;
}

const OP_NAMES: Record<BooleanOp, string> = { union: 'Union', subtract: 'Subtract', intersect: 'Intersect', exclude: 'Exclude' };
