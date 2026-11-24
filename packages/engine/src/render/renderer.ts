// Renderer: draws the page's node tree through the camera, then the selection
// overlay (outlines, handles, marquee) in screen space so it stays crisp.
// The backing store follows devicePixelRatio so it stays sharp on phones.
// Each top-level node (board) is recorded once as an SkPicture and replayed
// until something inside it changes, so dragging one shape doesn't re-walk
// every other board.

import type { Canvas, CanvasKit, ImageFilter, Paint as SkPaint, Path as SkPath, SkPicture, Surface } from 'canvaskit-wasm';
import type { Camera } from '../camera/camera.ts';
import type { Doc } from '../doc/document.ts';
import type { BlendMode, Node, Paint, RGBA, Shadow, Stroke } from '../doc/types.ts';
import { intersects, type Affine, type Point, type Rect } from '../geom/affine.ts';
import { worldBounds, worldCorners } from '../editor/bounds.ts';
import type { Editor } from '../editor/editor.ts';
import { gradientHandles, handlesFor, selectionQuad } from '../editor/handles.ts';

export interface RendererTheme {
  background: RGBA; // the area around the boards
  accent: RGBA;     // selection colour
}

export class Renderer {
  private surface: Surface | null = null;
  private fill: SkPaint;
  private line: SkPaint;
  private dpr = 1;
  private pictures = new Map<string, SkPicture>();
  private picturesFor: Doc | null = null;

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
    const doc = editor.doc;
    this.dropStalePictures(doc, editor.pageId);
    for (const n of doc.children(editor.pageId)) {
      // Skip top-level nodes entirely off screen.
      const b = worldBounds(doc, [n]);
      if (!b || !intersects(b, view)) continue;
      let pic = this.pictures.get(n.id);
      if (!pic) {
        const rec = new this.ck.PictureRecorder();
        this.drawNode(rec.beginRecording(this.ck.XYWHRect(b.x, b.y, b.width, b.height)), doc, n);
        pic = rec.finishRecordingAsPicture();
        rec.delete();
        this.pictures.set(n.id, pic);
      }
      c.drawPicture(pic);
    }
    c.restore();

    c.save();
    c.scale(this.dpr, this.dpr);
    this.drawOverlay(c, camera, editor);
    c.restore();
    surface.flush();
  }

  /** Forget the pictures of boards whose contents changed (or all of them for a new document). */
  private dropStalePictures(doc: Doc, pageId: string): void {
    const touched = doc.takeTouched();
    if (this.picturesFor !== doc) {
      this.picturesFor = doc;
      this.clearPictures();
      return;
    }
    for (const id of touched) {
      // A node that was top-level until now (moved into a board, deleted) drops its own picture too.
      this.pictures.get(id)?.delete();
      this.pictures.delete(id);
      // Walk up to the page's child; a removed node's parent was recorded too.
      let top = id;
      for (let n = doc.get(id); n && n.parentId && n.parentId !== pageId; n = doc.get(n.parentId)) top = n.parentId;
      this.pictures.get(top)?.delete();
      this.pictures.delete(top);
    }
  }

  private clearPictures(): void {
    this.pictures.forEach(p => p.delete());
    this.pictures.clear();
  }

  destroy(): void {
    this.clearPictures();
    this.fill.delete();
    this.line.delete();
    this.surface?.delete();
    this.surface = null;
  }

  // ── Document ─────────────────────────────────────────────────

  /**
   * One node and its subtree, in its own space. Order, like Figma: background
   * blur, then (isolated when there is opacity, a blend mode or effects) drop
   * shadows, the content, inner shadows; a layer blur blurs that whole layer.
   */
  private drawNode(c: Canvas, doc: Doc, n: Node): void {
    if (!n.visible) return;
    c.save();
    c.concat(this.matrix(n.transform));
    const fx = n.effects.filter(e => e.visible);
    const outline = this.outline(n);

    for (const e of fx) {
      if (e.kind !== 'backgroundBlur' || !outline) continue;
      // Blur what is already drawn, inside the node's outline.
      const blur = this.ck.ImageFilter.MakeBlur(e.radius / 2, e.radius / 2, this.ck.TileMode.Clamp, null);
      c.save();
      c.clipPath(outline, this.ck.ClipOp.Intersect, true);
      c.saveLayer(undefined, null, blur);
      c.restore();
      c.restore();
      blur.delete();
    }

    const isolate = n.opacity < 1 || n.blendMode !== 'normal' || fx.length > 0;
    const layerBlur = fx.find(e => e.kind === 'layerBlur');
    let layerFilter: ImageFilter | null = null;
    if (isolate) {
      const paint = new this.ck.Paint();
      paint.setAlphaf(n.opacity);
      paint.setBlendMode(this.blend(n.blendMode));
      if (layerBlur?.kind === 'layerBlur') {
        layerFilter = this.ck.ImageFilter.MakeBlur(layerBlur.radius / 2, layerBlur.radius / 2, this.ck.TileMode.Decal, null);
        paint.setImageFilter(layerFilter);
      }
      c.saveLayer(paint);
      paint.delete();
    }

    for (const e of fx) if (e.kind === 'dropShadow') this.withFilter(c, this.dropShadow(e), undefined, () => this.drawContent(c, doc, n, outline));
    this.drawContent(c, doc, n, outline);
    for (const e of fx) if (e.kind === 'innerShadow') this.withFilter(c, this.innerShadow(e), this.ck.BlendMode.SrcATop, () => this.drawContent(c, doc, n, outline));

    if (isolate) c.restore();
    layerFilter?.delete();
    outline?.delete();
    c.restore();
  }

  /** The node's own shape, for fills, strokes, clipping and background blur. */
  private outline(n: Node): SkPath | null {
    const b = new this.ck.PathBuilder();
    const rect = this.ck.XYWHRect(0, 0, n.width, n.height);
    switch (n.type) {
      case 'frame':
      case 'rect': {
        const r = n.cornerRadius ?? 0;
        b.addRRect(this.ck.RRectXY(rect, r, r));
        break;
      }
      case 'ellipse':
        b.addOval(rect);
        break;
      default:
        b.delete();
        return null;
    }
    return b.detachAndDelete();
  }

  /** Fills, children (clipped for frames) and strokes, without effects. */
  private drawContent(c: Canvas, doc: Doc, n: Node, outline: SkPath | null): void {
    if (outline) for (const f of n.fills) this.drawPaint(c, n, f, p => c.drawPath(outline, p));
    if (n.type === 'frame' || n.type === 'group') {
      c.save();
      if (n.type === 'frame' && n.clipContent && outline) c.clipPath(outline, this.ck.ClipOp.Intersect, true);
      doc.children(n.id).forEach(k => this.drawNode(c, doc, k));
      c.restore();
    }
    if (outline) for (const s of n.strokes) this.drawStroke(c, n, s, outline);
  }

  /** Strokes are centred on the outline; inside/outside double the width and clip half away. */
  private drawStroke(c: Canvas, n: Node, s: Stroke, outline: SkPath): void {
    if (!s.paint.visible || s.width <= 0) return;
    c.save();
    if (s.align !== 'center') c.clipPath(outline, s.align === 'inside' ? this.ck.ClipOp.Intersect : this.ck.ClipOp.Difference, true);
    const width = s.align === 'center' ? s.width : s.width * 2;
    this.drawPaint(c, n, s.paint, p => {
      p.setStyle(this.ck.PaintStyle.Stroke);
      p.setStrokeWidth(width);
      c.drawPath(outline, p);
    });
    c.restore();
  }

  /** Set up a paint for a solid or gradient fill over the node's box, draw, clean up. */
  private drawPaint(c: Canvas, n: Node, f: Paint, draw: (p: SkPaint) => void): void {
    if (!f.visible) return;
    const p = new this.ck.Paint();
    p.setAntiAlias(true);
    p.setBlendMode(this.blend(f.blendMode));
    p.setAlphaf(f.opacity);
    let shader = null;
    if (f.kind === 'solid') {
      p.setColor(this.color(f.color, f.opacity));
    } else {
      const a = { x: f.from.x * n.width, y: f.from.y * n.height };
      const b = { x: f.to.x * n.width, y: f.to.y * n.height };
      const colors = f.stops.map(st => this.color(st.color));
      const pos = f.stops.map(st => st.offset);
      shader = f.kind === 'linear'
        ? this.ck.Shader.MakeLinearGradient([a.x, a.y], [b.x, b.y], colors, pos, this.ck.TileMode.Clamp)
        : this.ck.Shader.MakeRadialGradient([a.x, a.y], Math.max(1e-3, Math.hypot(b.x - a.x, b.y - a.y)), colors, pos, this.ck.TileMode.Clamp);
      p.setShader(shader);
    }
    draw(p);
    shader?.delete();
    p.delete();
  }

  /** Draw `body` into a layer with an image filter (and optional blend), then free the filter. */
  private withFilter(c: Canvas, filter: ImageFilter, blend: ReturnType<Renderer['blend']> | undefined, body: () => void): void {
    const paint = new this.ck.Paint();
    paint.setImageFilter(filter);
    if (blend) paint.setBlendMode(blend);
    c.saveLayer(paint);
    body();
    c.restore();
    paint.delete();
    filter.delete();
  }

  /** Spread grows (or, negative, shrinks) the alpha before it is blurred. */
  private spread(amount: number, input: ImageFilter | null): ImageFilter | null {
    if (!amount) return input;
    return amount > 0 ? this.ck.ImageFilter.MakeDilate(amount, amount, input) : this.ck.ImageFilter.MakeErode(-amount, -amount, input);
  }

  private dropShadow(e: Shadow): ImageFilter {
    return this.ck.ImageFilter.MakeDropShadowOnly(e.x, e.y, e.blur / 2, e.blur / 2, this.color(e.color), this.spread(e.spread, null));
  }

  /**
   * The content's alpha turned inside out and filled with the shadow colour,
   * grown by spread, offset and blurred; drawn SrcATop so it only lands on the content.
   */
  private innerShadow(e: Shadow): ImageFilter {
    const { r, g, b, a } = e.color;
    const invert = this.ck.ColorFilter.MakeMatrix([
      0, 0, 0, 0, r,
      0, 0, 0, 0, g,
      0, 0, 0, 0, b,
      0, 0, 0, -a, a,
    ]);
    const base = this.ck.ImageFilter.MakeColorFilter(invert, null);
    invert.delete();
    const moved = this.ck.ImageFilter.MakeOffset(e.x, e.y, this.spread(e.spread, base));
    return this.ck.ImageFilter.MakeBlur(e.blur / 2, e.blur / 2, this.ck.TileMode.Decal, moved);
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
    // Gradient end points: a line between two rings filled with the end colours.
    const gh = gradientHandles(editor, camera);
    const g = editor.gradientEdit && editor.gradientPaint(editor.gradientEdit);
    if (gh && g) {
      this.line.setColor(this.ck.WHITE);
      this.line.setStrokeWidth(3);
      c.drawLine(gh.from.x, gh.from.y, gh.to.x, gh.to.y, this.line);
      this.line.setColor(accent);
      this.line.setStrokeWidth(1.5);
      c.drawLine(gh.from.x, gh.from.y, gh.to.x, gh.to.y, this.line);
      const ends: [Point, RGBA][] = [[gh.from, g.stops[0]!.color], [gh.to, g.stops[g.stops.length - 1]!.color]];
      for (const [q, col] of ends) {
        this.fill.setColor(this.ck.WHITE);
        c.drawCircle(q.x, q.y, 9, this.fill);
        this.fill.setColor(this.color({ ...col, a: 1 }));
        c.drawCircle(q.x, q.y, 6, this.fill);
        c.drawCircle(q.x, q.y, 9, this.line);
      }
    }

    // Snap guides: thin magenta lines.
    if (editor.guides.length) {
      this.line.setColor(this.color({ r: 1, g: 0.2, b: 0.55, a: 1 }));
      this.line.setStrokeWidth(1);
      for (const g of editor.guides) {
        const a = camera.worldToScreen(g.a), b = camera.worldToScreen(g.b);
        c.drawLine(a.x, a.y, b.x, b.y, this.line);
      }
      this.line.setColor(accent);
      this.line.setStrokeWidth(1.5);
    }

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
