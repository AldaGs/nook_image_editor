// Renderer: owns the WebGL surface and draws the document through the camera.
// The canvas backing store follows devicePixelRatio so it stays sharp on phones.

import type { CanvasKit, Surface, Paint } from 'canvaskit-wasm';
import type { Camera } from '../camera/camera.ts';
import type { RectNode, RGBA } from '../doc/types.ts';

export interface RendererTheme {
  background: RGBA; // the area around the boards
}

export class Renderer {
  private surface: Surface | null = null;
  private paint: Paint;
  private dpr = 1;

  constructor(private ck: CanvasKit, private canvas: HTMLCanvasElement, public theme: RendererTheme) {
    this.paint = new ck.Paint();
    this.paint.setAntiAlias(true);
  }

  /** Match the backing store to the element's CSS size. Call on resize. */
  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3); // cap: 3x is plenty and saves GPU memory
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr));
    if (this.surface && this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.surface?.delete();
    this.surface = this.ck.MakeWebGLCanvasSurface(this.canvas);
    if (!this.surface) throw new Error('WebGL2 is not available, so Nook cannot draw.');
  }

  render(camera: Camera, nodes: readonly RectNode[]): void {
    const surface = this.surface;
    if (!surface) return;
    const c = surface.getCanvas();
    c.clear(this.color(this.theme.background));

    // World → device pixels: scale by zoom and dpr, then offset by the camera origin.
    c.save();
    c.scale(camera.zoom * this.dpr, camera.zoom * this.dpr);
    c.translate(-camera.x, -camera.y);
    for (const n of nodes) {
      this.paint.setColor(this.color(n.fill));
      const rect = this.ck.XYWHRect(n.x, n.y, n.width, n.height);
      c.drawRRect(this.ck.RRectXY(rect, n.radius, n.radius), this.paint);
    }
    c.restore();
    surface.flush();
  }

  destroy(): void {
    this.paint.delete();
    this.surface?.delete();
    this.surface = null;
  }

  private color(c: RGBA) {
    return this.ck.Color4f(c.r, c.g, c.b, c.a);
  }
}
