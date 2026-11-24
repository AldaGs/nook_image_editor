// Renderer: draws the page's node tree through the camera, then the selection
// overlay (outlines, handles, marquee) in screen space so it stays crisp.
// The backing store follows devicePixelRatio so it stays sharp on phones.

import type { Canvas, CanvasKit, Paint as SkPaint, Surface } from 'canvaskit-wasm';
import type { Camera } from '../camera/camera.ts';
import type { Doc } from '../doc/document.ts';
import type { BlendMode, Node, RGBA } from '../doc/types.ts';
import { intersects, type Affine, type Point, type Rect } from '../geom/affine.ts';
import { worldBounds, worldCorners } from '../editor/bounds.ts';
import type { Editor } from '../editor/editor.ts';
import { handlesFor, selectionQuad } from '../editor/handles.ts';

export interface RendererTheme {
  background: RGBA; // the area around the boards
  accent: RGBA;     // selection colour
}

export class Renderer {
  private surface: Surface | null = null;
  private fill: SkPaint;
  private line: SkPaint;
  private layer: SkPaint; // reused for opacity layers
  private dpr = 1;

  private ck: CanvasKit;
  private canvas: HTMLCanvasElement;
  theme: RendererTheme;

  constructor(ck: CanvasKit, canvas: HTMLCanvasElement, theme: RendererTheme) {
    this.ck = ck;
    this.canvas = canvas;
    this.theme = theme;
    this.fill = new ck.Paint();
    this.fill.setAntiAlias(true);
    this.line = new ck.Paint();
    this.line.setAntiAlias(true);
    this.line.setStyle(ck.PaintStyle.Stroke);
    this.layer = new ck.Paint();
  }

  /** Match the backing store to the element's CSS size. Call on resize. */
  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3); // 3x is plenty and saves GPU memory
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr));
    if (this.surface && this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.surface?.delete();
    this.surface = this.ck.MakeWebGLCanvasSurface(this.canvas);
    if (!this.surface) throw new Error('WebGL2 is not available, so Nook cannot draw.');
  }

  render(camera: Camera, editor: Editor): void {
    const surface = this.surface;
    if (!surface) return;
    const c = surface.getCanvas();
    c.clear(this.color(this.theme.background));

    // World → device pixels.
    c.save();
    c.scale(camera.zoom * this.dpr, camera.zoom * this.dpr);
    c.translate(-camera.x, -camera.y);
    const view = this.viewRect(camera);
    for (const n of editor.doc.children(editor.pageId)) {
      // Skip top-level nodes entirely off screen.
      const b = worldBounds(editor.doc, [n]);
      if (b && !intersects(b, view)) continue;
      this.drawNode(c, editor.doc, n);
    }
    c.restore();

    c.save();
    c.scale(this.dpr, this.dpr);
    this.drawOverlay(c, camera, editor);
    c.restore();
    surface.flush();
  }

  destroy(): void {
    this.fill.delete();
    this.line.delete();
    this.layer.delete();
    this.surface?.delete();
    this.surface = null;
  }

  // ── Document ─────────────────────────────────────────────────

  private drawNode(c: Canvas, doc: Doc, n: Node): void {
    if (!n.visible) return;
    c.save();
    c.concat(this.matrix(n.transform));
    // Partial opacity on containers needs a layer so overlapping children don't double up.
    const layered = n.opacity < 1 && (n.type === 'frame' || n.type === 'group');
    if (layered) c.saveLayer(this.alphaPaint(n.opacity));
    const alpha = layered ? 1 : n.opacity;

    switch (n.type) {
      case 'frame': {
        const rr = this.ck.RRectXY(this.ck.XYWHRect(0, 0, n.width, n.height), n.cornerRadius ?? 0, n.cornerRadius ?? 0);
        this.paintFills(c, n, alpha, k => k.drawRRect(rr, this.fill));
        if (n.clipContent) c.clipRRect(rr, this.ck.ClipOp.Intersect, true);
        doc.children(n.id).forEach(k => this.drawNode(c, doc, k));
        break;
      }
      case 'group':
        doc.children(n.id).forEach(k => this.drawNode(c, doc, k));
        break;
      case 'rect': {
        const rr = this.ck.RRectXY(this.ck.XYWHRect(0, 0, n.width, n.height), n.cornerRadius ?? 0, n.cornerRadius ?? 0);
        this.paintFills(c, n, alpha, k => k.drawRRect(rr, this.fill));
        break;
      }
      case 'ellipse':
        this.paintFills(c, n, alpha, k => k.drawOval(this.ck.XYWHRect(0, 0, n.width, n.height), this.fill));
        break;
      default:
        break; // other node types arrive in later stages
    }
    if (layered) c.restore();
    c.restore();
  }

  /** Draw each visible fill, bottom to top. */
  private paintFills(c: Canvas, n: Node, alpha: number, draw: (c: Canvas) => void): void {
    for (const f of n.fills) {
      if (!f.visible) continue;
      this.fill.setColor(this.color(f.color, f.opacity * alpha));
      this.fill.setBlendMode(this.blend(f.blendMode));
      draw(c);
    }
    this.fill.setBlendMode(this.ck.BlendMode.SrcOver);
  }

  // ── Overlay (screen space) ───────────────────────────────────

  private drawOverlay(c: Canvas, camera: Camera, editor: Editor): void {
    const accent = this.color(this.theme.accent);
    this.line.setColor(accent);
    this.line.setStrokeWidth(1.5);

    // Outline every selected node.
    for (const n of editor.selectedNodes()) {
      const path = this.polygon(worldCorners(editor.doc, n).map(p => camera.worldToScreen(p)));
      c.drawPath(path, this.line);
      path.delete(); // CanvasKit objects live in WASM memory: free them
    }
    // Several selected: also the box around all of them.
    if (editor.selection.length > 1) {
      const b = worldBounds(editor.doc, editor.selectedNodes());
      if (b) c.drawRect(this.screenRect(camera, b), this.line);
    }

    // Handles: white squares; rotate is a circle joined to the top edge.
    const quad = selectionQuad(editor, camera);
    for (const h of handlesFor(editor, camera)) {
      if (h.id === 'rotate' && quad) {
        const top = { x: (quad[0]!.x + quad[1]!.x) / 2, y: (quad[0]!.y + quad[1]!.y) / 2 };
        c.drawLine(top.x, top.y, h.screen.x, h.screen.y, this.line);
        this.fill.setColor(this.ck.WHITE);
        c.drawCircle(h.screen.x, h.screen.y, 6, this.fill);
        c.drawCircle(h.screen.x, h.screen.y, 6, this.line);
      } else {
        const r = this.ck.XYWHRect(h.screen.x - 5, h.screen.y - 5, 10, 10);
        this.fill.setColor(this.ck.WHITE);
        c.drawRect(r, this.fill);
        c.drawRect(r, this.line);
      }
    }

    // Marquee: translucent fill + outline.
    if (editor.marquee) {
      const r = this.screenRect(camera, editor.marquee);
      this.fill.setColor(this.color(this.theme.accent, 0.12));
      c.drawRect(r, this.fill);
      c.drawRect(r, this.line);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────

  /** Our [a, b, c, d, tx, ty] → CanvasKit's row-major 3×3. */
  private matrix(m: Affine): number[] {
    return [m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1];
  }

  private polygon(pts: Point[]) {
    // Paths are immutable in CanvasKit 0.42: build, then detach the result.
    return new this.ck.PathBuilder().addPolygon(pts.flatMap(q => [q.x, q.y]), true).detachAndDelete();
  }

  private screenRect(camera: Camera, r: Rect) {
    const a = camera.worldToScreen({ x: r.x, y: r.y });
    return this.ck.XYWHRect(a.x, a.y, r.width * camera.zoom, r.height * camera.zoom);
  }

  private viewRect(camera: Camera): Rect {
    return { x: camera.x, y: camera.y, width: this.canvas.clientWidth / camera.zoom, height: this.canvas.clientHeight / camera.zoom };
  }

  private alphaPaint(alpha: number): SkPaint {
    this.layer.setAlphaf(alpha);
    return this.layer;
  }

  private color(c: RGBA, alpha = 1) {
    return this.ck.Color4f(c.r, c.g, c.b, c.a * alpha);
  }

  private blend(mode: BlendMode) {
    const B = this.ck.BlendMode;
    const map: Record<BlendMode, typeof B.SrcOver> = {
      normal: B.SrcOver, multiply: B.Multiply, screen: B.Screen, overlay: B.Overlay,
      darken: B.Darken, lighten: B.Lighten, colorDodge: B.ColorDodge, colorBurn: B.ColorBurn,
      hardLight: B.HardLight, softLight: B.SoftLight, difference: B.Difference, exclusion: B.Exclusion,
      hue: B.Hue, saturation: B.Saturation, color: B.Color, luminosity: B.Luminosity,
    };
    return map[mode];
  }
}
