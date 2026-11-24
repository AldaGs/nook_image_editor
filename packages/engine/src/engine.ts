// Engine entry point: wires CanvasKit, camera, gestures, renderer and frame loop
// to one <canvas>. The UI talks to the engine only through this handle.

import { Camera } from './camera/camera.ts';
import { attachGestures } from './input/gestures.ts';
import { loadCanvasKit } from './render/canvaskit.ts';
import { FrameLoop } from './render/frameloop.ts';
import { Renderer, type RendererTheme } from './render/renderer.ts';
import type { RectNode } from './doc/types.ts';

export interface EngineOptions {
  wasmUrl: string;
  theme: RendererTheme;
  onFps?: (fps: number) => void;
}

export interface Engine {
  camera: Camera;
  setNodes(nodes: RectNode[]): void;
  /** Fit all nodes in view. */
  zoomToFit(): void;
  setTheme(theme: RendererTheme): void;
  destroy(): void;
}

export async function createEngine(canvas: HTMLCanvasElement, opts: EngineOptions): Promise<Engine> {
  const ck = await loadCanvasKit(opts.wasmUrl);
  const camera = new Camera();
  const renderer = new Renderer(ck, canvas, opts.theme);
  let nodes: RectNode[] = [];

  const loop = new FrameLoop(() => renderer.render(camera, nodes), opts.onFps ?? (() => {}));
  const detachGestures = attachGestures(canvas, camera, () => loop.invalidate());

  // Keep the surface sized to the element (rotation, keyboard, split view).
  const resize = new ResizeObserver(() => {
    renderer.resize();
    loop.invalidate();
  });
  resize.observe(canvas);
  renderer.resize();
  loop.start();

  const zoomToFit = () => {
    if (!nodes.length) return;
    const x0 = Math.min(...nodes.map(n => n.x)), y0 = Math.min(...nodes.map(n => n.y));
    const x1 = Math.max(...nodes.map(n => n.x + n.width)), y1 = Math.max(...nodes.map(n => n.y + n.height));
    camera.fit({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, { width: canvas.clientWidth, height: canvas.clientHeight });
    loop.invalidate();
  };

  return {
    camera,
    setNodes(next) { nodes = next; loop.invalidate(); },
    zoomToFit,
    setTheme(theme) { renderer.theme = theme; loop.invalidate(); },
    destroy() {
      loop.stop();
      resize.disconnect();
      detachGestures();
      renderer.destroy();
    },
  };
}
