// Engine entry point: wires CanvasKit, camera, input, tools, renderer and the
// frame loop to one <canvas>, around an Editor. The UI talks to the engine only
// through this handle and the Editor.

import { Camera } from './camera/camera.ts';
import { attachInput } from './input/router.ts';
import { loadCanvasKit } from './render/canvaskit.ts';
import { FrameLoop } from './render/frameloop.ts';
import { Renderer, type RendererTheme } from './render/renderer.ts';
import { estimateText, type Editor, type ToolId } from './editor/editor.ts';
import { worldBounds } from './editor/bounds.ts';
import { SelectTool } from './editor/tools/select.ts';
import { ShapeTool } from './editor/tools/shape.ts';
import { TextTool } from './editor/tools/text.ts';
import type { Tool, ToolContext } from './editor/tools/tool.ts';
import type { Point } from './geom/affine.ts';

export interface EngineOptions {
  wasmUrl: string;
  theme: RendererTheme;
  editor: Editor;
  onFps?: (fps: number) => void;
  /** Called after every redraw that moved the camera or changed the document. */
  onView?: () => void;
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
  renderer.onFontsChanged = () => { editor.refreshTextBoxes(); loop.invalidate(); };
  editor.measureText = (t, w) => renderer.measure(t, w);
  editor.refreshTextBoxes();
  const ctx: ToolContext = { editor, camera, invalidate: () => loop.invalidate() };
  const tools: Record<ToolId, Tool> = {
    select: new SelectTool(ctx),
    rect: new ShapeTool(ctx, 'rect'),
    ellipse: new ShapeTool(ctx, 'ellipse'),
    frame: new ShapeTool(ctx, 'frame'),
    text: new TextTool(ctx),
  };

  const detachInput = attachInput(canvas, camera, () => tools[editor.tool], () => loop.invalidate());
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
