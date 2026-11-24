// Engine entry point: wires CanvasKit, camera, input, tools, renderer and the
// frame loop to one <canvas>, around an Editor. The UI talks to the engine only
// through this handle and the Editor.

import { Camera } from './camera/camera.ts';
import type { VectorPath } from './doc/shapes.ts';
import { attachInput } from './input/router.ts';
import { loadCanvasKit } from './render/canvaskit.ts';
import { FrameLoop } from './render/frameloop.ts';
import { Renderer, type RendererTheme } from './render/renderer.ts';
import { estimateText, type Editor, type ToolId } from './editor/editor.ts';
import type { RGBA, TextProps } from './doc/types.ts';
import { worldBounds } from './editor/bounds.ts';
import { SelectTool } from './editor/tools/select.ts';
import { ShapeTool } from './editor/tools/shape.ts';
import { PenTool } from './editor/tools/pen.ts';
import { TextTool } from './editor/tools/text.ts';
import type { Tool, ToolContext } from './editor/tools/tool.ts';
import { apply, invert, type Point, type Rect } from './geom/affine.ts';

export interface EngineOptions {
  wasmUrl: string;
  theme: RendererTheme;
  editor: Editor;
  onFps?: (fps: number) => void;
  /** Called after every redraw that moved the camera or changed the document. */
  onView?: () => void;
  /** An image file by asset id (content hash); null if it isn't stored. */
  loadAsset?: (id: string) => Promise<ArrayBuffer | null>;
  /** Font file for a family at (or nearest to) a weight; null if there isn't one. */
  loadFont?: (family: string, weight: number) => Promise<ArrayBuffer | null>;
}

export interface FrameLabel { id: string; name: string; screen: Point; selected: boolean }

export interface Engine {
  camera: Camera;
  /** Fit the given nodes (default: everything on the page) in view. */
  zoomToFit(ids?: string[]): void;
  /** Screen positions of top-level frame names, for the UI to draw as labels. */
  frameLabels(): FrameLabel[];
  setTheme(theme: RendererTheme): void;
  /**
   * Pan so the text caret sits inside `visible` (CSS px relative to the
   * canvas), e.g. the part of the screen the on-screen keyboard leaves free.
   * Returns the caret's screen position for placing the hidden input.
   */
  revealCaret(visible: Rect): Point | null;
  /**
   * Eyedropper: the next press on the canvas reports the colour under it
   * instead of going to the tool. Resolves null if cancelled.
   */
  pickColor(): Promise<RGBA | null>;
  cancelPickColor(): void;
  /**
   * A board drawn on its own at `scale` as straight-alpha RGBA pixels (for
   * PNG/JPG/WebP export), after its pictures and fonts have loaded.
   */
  renderBoard(id: string, scale: number): Promise<{ width: number; height: number; pixels: Uint8Array } | null>;
  /** A text block's widest line and height, wrapped at `width` (null: no wrapping). */
  measureLines(t: TextProps, width: number | null): { width: number; height: number };
  /**
   * Turn the selected layers into plain paths of their outline: a boolean's
   * merged shape, a group's union, a shape's own outline. Text, pictures and
   * boards are left alone. Returns how many were flattened.
   */
  flatten(): number;
  /** A layer's merged outline in its own space (booleans' result), for SVG export. */
  outline(id: string): { contours: VectorPath[]; fillRule: 'nonzero' | 'evenodd' } | null;
  invalidate(): void;
  destroy(): void;
}

export async function createEngine(canvas: HTMLCanvasElement, opts: EngineOptions): Promise<Engine> {
  const ck = await loadCanvasKit(opts.wasmUrl);
  const { editor } = opts;
  const camera = new Camera();
  const renderer = new Renderer(ck, canvas, opts.theme);

  const loop = new FrameLoop(() => { renderer.render(camera, editor); opts.onView?.(); }, opts.onFps ?? (() => {}));
  // Text is measured with the real fonts from here on; boxes sized by the estimate catch up as fonts arrive.
  renderer.loadFont = opts.loadFont ?? null;
  renderer.loadAsset = opts.loadAsset ?? null;
  renderer.onImagesChanged = () => loop.invalidate();
  renderer.onFontsChanged = () => { editor.refreshTextBoxes(); loop.invalidate(); };
  editor.measureText = (t, w) => renderer.measure(t, w);
  editor.refreshTextBoxes();
  const ctx: ToolContext = {
    editor,
    camera,
    invalidate: () => loop.invalidate(),
    textIndexAt(id, world) {
      const n = editor.doc.get(id);
      return n ? renderer.textIndexAt(n, apply(invert(editor.doc.worldTransform(id)), world)) : 0;
    },
  };
  const tools: Record<ToolId, Tool> = {
    select: new SelectTool(ctx),
    rect: new ShapeTool(ctx, 'rect'),
    ellipse: new ShapeTool(ctx, 'ellipse'),
    polygon: new ShapeTool(ctx, 'polygon'),
    star: new ShapeTool(ctx, 'star'),
    line: new ShapeTool(ctx, 'line'),
    pen: new PenTool(ctx),
    frame: new ShapeTool(ctx, 'frame'),
    text: new TextTool(ctx),
  };

  // The eyedropper takes one press, then hands input back to the tools.
  let picking: ((c: RGBA | null) => void) | null = null;
  const pickTool: Tool = {
    down(p) {
      const done = picking;
      picking = null;
      done?.(renderer.sample(camera, editor, p.screen));
      loop.invalidate();
    },
    move() {},
    up() {},
    cancel() {},
  };
  const detachInput = attachInput(canvas, camera, () => picking ? pickTool : tools[editor.tool], () => loop.invalidate());
  const unsubscribe = editor.subscribe(() => loop.invalidate());

  // Keep the surface sized to the element (rotation, keyboard, split view).
  const resize = new ResizeObserver(() => { renderer.resize(); loop.invalidate(); });
  resize.observe(canvas);
  renderer.resize();
  loop.start();

  return {
    camera,
    zoomToFit(ids) {
      const nodes = ids?.length
        ? ids.map(id => editor.doc.get(id)!).filter(Boolean)
        : editor.doc.children(editor.pageId);
      const b = worldBounds(editor.doc, nodes);
      if (!b) return;
      camera.fit({ ...b, width: Math.max(b.width, 1), height: Math.max(b.height, 1) }, { width: canvas.clientWidth, height: canvas.clientHeight });
      loop.invalidate();
    },
    frameLabels() {
      return editor.doc.children(editor.pageId)
        .filter(n => n.type === 'frame' && n.visible)
        .map(n => {
          const b = worldBounds(editor.doc, [n])!;
          return { id: n.id, name: n.name, screen: camera.worldToScreen({ x: b.x, y: b.y }), selected: editor.selection.includes(n.id) };
        });
    },
    setTheme(theme) { renderer.theme = theme; loop.invalidate(); },
    measureLines: (t, width) => renderer.measureLines(t, width),
    outline(id) {
      const n = editor.doc.get(id);
      return n ? renderer.flattenContours(editor.doc, n) : null;
    },
    flatten() {
      const done: string[] = [];
      editor.history.begin('Flatten');
      for (const n of editor.topmostSelected()) {
        if (n.type === 'frame' || n.type === 'text' || n.type === 'page') continue;
        if (n.fills.some(f => f.kind === 'image')) continue;
        const r = renderer.flattenContours(editor.doc, n);
        if (!r?.contours.length) continue;
        editor.replaceWithPath(n, r.contours, r.fillRule);
        done.push(...editor.selection);
      }
      editor.history.commit();
      if (done.length) editor.select(done);
      return done.length;
    },
    async renderBoard(id, scale) {
      const n = editor.doc.get(id);
      return n ? renderer.renderPixels(editor.doc, n, scale) : null;
    },
    pickColor() {
      picking?.(null);
      return new Promise(resolve => { picking = resolve; });
    },
    cancelPickColor() {
      const done = picking;
      picking = null;
      done?.(null);
    },
    revealCaret(visible) {
      const te = editor.textEdit;
      const n = te && editor.doc.get(te.nodeId);
      if (!te || !n?.text) return null;
      const { caret } = renderer.textGeometry(n, te.end, te.end);
      const m = editor.doc.worldTransform(n.id);
      const top = camera.worldToScreen(apply(m, { x: caret.x, y: caret.y }));
      const bottom = camera.worldToScreen(apply(m, { x: caret.x, y: caret.y + caret.h }));
      const margin = 24;
      let dx = 0, dy = 0;
      if (Math.max(top.y, bottom.y) > visible.y + visible.height - margin) dy = visible.y + visible.height - margin - Math.max(top.y, bottom.y);
      if (Math.min(top.y, bottom.y) < visible.y + margin) dy = visible.y + margin - Math.min(top.y, bottom.y);
      if (top.x > visible.x + visible.width - margin) dx = visible.x + visible.width - margin - top.x;
      if (top.x < visible.x + margin) dx = visible.x + margin - top.x;
      if (dx || dy) { camera.panBy(dx, dy); loop.invalidate(); }
      return { x: bottom.x + dx, y: bottom.y + dy };
    },
    invalidate: () => loop.invalidate(),
    destroy() {
      loop.stop();
      resize.disconnect();
      detachInput();
      unsubscribe();
      editor.measureText = estimateText;
      renderer.destroy();
    },
  };
}
