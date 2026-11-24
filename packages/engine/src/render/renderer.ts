// Renderer: draws the page's node tree through the camera, then the selection
// overlay (outlines, handles, marquee) in screen space so it stays crisp.
// The backing store follows devicePixelRatio so it stays sharp on phones.
// Each top-level node (board) is recorded once as an SkPicture and replayed
// until something inside it changes, so dragging one shape doesn't re-walk
// every other board.

import type { Canvas, CanvasKit, Image as SkImage, ImageFilter, Paint as SkPaint, Paragraph, Path as SkPath, SkPicture, Surface, TypefaceFontProvider } from 'canvaskit-wasm';
import type { Camera } from '../camera/camera.ts';
import type { Doc } from '../doc/document.ts';
import type { BlendMode, Node, Paint, RGBA, Shadow, Stroke, TextProps } from '../doc/types.ts';
import { apply, intersects, invert, multiply, type Affine, type Point, type Rect } from '../geom/affine.ts';
import { worldBounds, worldCorners } from '../editor/bounds.ts';
import type { Editor } from '../editor/editor.ts';
import { gradientHandles, handlesFor, selectionQuad } from '../editor/handles.ts';
import { STORY_SAFE_ZONE, isStoryShaped } from '../doc/factory.ts';

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
  private fonts: TypefaceFontProvider;
  private fontLoads = new Map<string, Promise<void>>();
  private clear: SkPaint; // transparent background paint for text runs
  /** Fetches a font's file for a family and weight (the app knows where fonts live). */
  loadFont: ((family: string, weight: number) => Promise<ArrayBuffer | null>) | null = null;
  /** Fetches an image file by its asset id (content hash). */
  loadAsset: ((id: string) => Promise<ArrayBuffer | null>) | null = null;
  /** Called after an image arrives, so the canvas redraws. */
  onImagesChanged: (() => void) | null = null;
  private images = new Map<string, SkImage | null>(); // null: loading, or failed
  private imageLoads = new Map<string, Promise<void>>();
  /** Called after a font arrives, so text can be re-measured and redrawn. */
  onFontsChanged: (() => void) | null = null;
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
    this.fonts = ck.TypefaceFontProvider.Make();
    this.clear = new ck.Paint();
    this.clear.setColor(ck.TRANSPARENT);
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

  render(camera: Camera, editor: Editor, overlay = true): void {
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

    if (overlay) {
      c.save();
      c.scale(this.dpr, this.dpr);
      this.drawOverlay(c, camera, editor);
      c.restore();
    }
    surface.flush();
  }

  /** The colour drawn at a screen point (CSS px), without the selection overlay. */
  sample(camera: Camera, editor: Editor, at: Point): RGBA | null {
    if (!this.surface) return null;
    this.render(camera, editor, false);
    const x = Math.round(at.x * this.dpr), y = Math.round(at.y * this.dpr);
    const info = { width: 1, height: 1, colorType: this.ck.ColorType.RGBA_8888, alphaType: this.ck.AlphaType.Unpremul, colorSpace: this.ck.ColorSpace.SRGB };
    const px = this.surface.getCanvas().readPixels(x, y, info);
    if (!px || px.length < 4) return null;
    return { r: px[0]! / 255, g: px[1]! / 255, b: px[2]! / 255, a: 1 };
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
    this.images.forEach(i => i?.delete());
    this.images.clear();
    this.clear.delete();
    this.fonts.delete();
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

  // ── Images ───────────────────────────────────────────────────

  /** The decoded image for an asset, or null while it loads (boards redraw when it arrives). */
  private image(id: string): SkImage | null {
    this.loadImage(id);
    return this.images.get(id) ?? null;
  }

  /** Start (once) decoding an asset; resolves when it is drawable, or has failed. */
  private loadImage(id: string): Promise<void> {
    let load = this.imageLoads.get(id);
    if (!load) {
      this.images.set(id, null);
      load = (this.loadAsset?.(id) ?? Promise.resolve(null)).then(buf => {
        const img = buf && this.ck.MakeImageFromEncoded(new Uint8Array(buf));
        if (!img) return;
        this.images.set(id, img);
        this.clearPictures();
        this.onImagesChanged?.();
      }).catch(() => { /* stays a placeholder */ });
      this.imageLoads.set(id, load);
    }
    return load;
  }

  // ── Text ─────────────────────────────────────────────────────

  /** Ask for a font once; when it arrives, cached boards are redrawn and text re-measured. */
  private ensureFont(family: string, weight: number): Promise<void> {
    const key = `${family}@${weight}`;
    let load = this.fontLoads.get(key);
    if (!load) {
      load = (this.loadFont?.(family, weight) ?? Promise.resolve(null)).then(buf => {
        if (!buf) return;
        this.fonts.registerFont(buf, family);
        this.clearPictures();
        this.onFontsChanged?.();
      }).catch(() => { this.fontLoads.delete(key); });
      this.fontLoads.set(key, load);
    }
    return load;
  }

  // ── Export ───────────────────────────────────────────────────

  /** Wait until every picture and font a subtree uses has loaded. */
  private async prepare(doc: Doc, root: Node): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const n of [root, ...doc.descendants(root.id)]) {
      for (const p of [...n.fills, ...n.strokes.map(s => s.paint)]) if (p.kind === 'image') waits.push(this.loadImage(p.assetId));
      if (n.text) waits.push(this.ensureFont(n.text.family, n.text.weight), this.ensureFont('Inter', 400));
    }
    await Promise.all(waits);
  }

  /**
   * A node (a board) drawn on its own at `scale`, as straight-alpha RGBA
   * pixels, once its pictures and fonts have loaded. Null if the surface
   * couldn't be made (too big for memory).
   */
  async renderPixels(doc: Doc, node: Node, scale: number): Promise<{ width: number; height: number; pixels: Uint8Array } | null> {
    await this.prepare(doc, node);
    const width = Math.max(1, Math.round(node.width * scale)), height = Math.max(1, Math.round(node.height * scale));
    const surface = this.ck.MakeSurface(width, height);
    if (!surface) return null;
    const c = surface.getCanvas();
    c.clear(this.ck.TRANSPARENT);
    c.scale(scale, scale);
    // Undo the node's place in the world so its box starts at (0, 0).
    const parent = node.parentId ? doc.worldTransform(node.parentId) : ([1, 0, 0, 1, 0, 0] as Affine);
    c.concat(this.matrix(multiply(invert(doc.worldTransform(node.id)), parent)));
    this.drawNode(c, doc, node);
    const info = { width, height, colorType: this.ck.ColorType.RGBA_8888, alphaType: this.ck.AlphaType.Unpremul, colorSpace: this.ck.ColorSpace.SRGB };
    const pixels = c.readPixels(0, 0, info) as Uint8Array | null;
    surface.delete();
    return pixels ? { width, height, pixels } : null;
  }

  /** Shape text with CanvasKit's Paragraph, painted with `fg` (black when measuring). */
  private paragraph(t: TextProps, fg: SkPaint | null, width: number): Paragraph {
    this.ensureFont(t.family, t.weight);
    this.ensureFont('Inter', 400); // fallback while a family loads, and for missing glyphs
    const W = this.ck.FontWeight;
    const weights = [W.Thin, W.ExtraLight, W.Light, W.Normal, W.Medium, W.SemiBold, W.Bold, W.ExtraBold, W.Black];
    const A = this.ck.TextAlign;
    const textStyle = new this.ck.TextStyle({
      color: this.ck.BLACK,
      fontFamilies: [t.family, 'Inter'],
      fontSize: t.size,
      letterSpacing: t.letterSpacing,
      fontStyle: { weight: weights[Math.min(8, Math.max(0, Math.round(t.weight / 100) - 1))]! },
      ...(t.lineHeight ? { heightMultiplier: t.lineHeight / t.size, halfLeading: true } : {}),
    });
    const style = new this.ck.ParagraphStyle({ textStyle, textAlign: { left: A.Left, center: A.Center, right: A.Right }[t.align] });
    const b = this.ck.ParagraphBuilder.MakeFromFontProvider(style, this.fonts);
    if (fg) b.pushPaintStyle(textStyle, fg, this.clear);
    b.addText(t.content || ' ');
    const p = b.build();
    b.delete();
    p.layout(width);
    return p;
  }

  /** The box text needs: wrapped at `width`, or one line per paragraph when null. */
  measure(t: TextProps, width: number | null): { width: number; height: number } {
    const p = this.paragraph(t, null, width ?? 1e6);
    const size = { width: width ?? p.getMaxIntrinsicWidth(), height: p.getHeight() };
    p.delete();
    return size;
  }

  private layoutFor(n: Node): Paragraph {
    const t = n.text!;
    return this.paragraph(t, null, t.sizing === 'autoWidth' ? n.width + 1 : n.width);
  }

  /** Character offset nearest a point in the text layer's own space. */
  textIndexAt(n: Node, local: Point): number {
    if (!n.text?.content) return 0;
    const p = this.layoutFor(n);
    const i = p.getGlyphPositionAtCoordinate(local.x, local.y).pos;
    p.delete();
    return Math.min(Math.max(0, i), n.text.content.length);
  }

  /** The caret at offset `i` (a vertical segment), and selection boxes for [start, end), in the layer's space. */
  textGeometry(n: Node, start: number, end: number): { caret: { x: number; y: number; h: number }; boxes: Rect[] } {
    const t = n.text!;
    const p = this.layoutFor(n);
    const lines = p.getLineMetrics();
    // The last line starting at or before the caret (a caret after a newline belongs to the next line).
    const line = [...lines].reverse().find(l => l.startIndex <= end) ?? lines[0];
    let x = 0;
    if (line) {
      if (!t.content) {
        x = { left: 0, center: n.width / 2, right: n.width }[t.align];
      } else if (end === line.startIndex) {
        x = line.left;
      } else {
        const r = p.getRectsForRange(end - 1, end, this.ck.RectHeightStyle.Max, this.ck.RectWidthStyle.Tight)[0];
        x = r ? (r.dir === this.ck.TextDirection.RTL ? r.rect[0]! : r.rect[2]!) : line.left + line.width;
      }
    }
    const caret = line ? { x, y: line.baseline - line.ascent, h: line.ascent + line.descent } : { x: 0, y: 0, h: t.size };
    const boxes = start === end ? [] : p.getRectsForRange(start, end, this.ck.RectHeightStyle.Max, this.ck.RectWidthStyle.Tight)
      .map(r => ({ x: r.rect[0]!, y: r.rect[1]!, width: r.rect[2]! - r.rect[0]!, height: r.rect[3]! - r.rect[1]! }));
    p.delete();
    return { caret, boxes };
  }

  /** The laid-out block: widest line and total height (what PBC centres text on). */
  measureLines(t: TextProps, width: number | null): { width: number; height: number } {
    const p = this.paragraph(t, null, width ?? 1e6);
    const size = { width: p.getLongestLine(), height: p.getHeight() };
    p.delete();
    return size;
  }

  /** Strokes set outside draw first at double width, under the fills; the rest draw on top. */
  private drawText(c: Canvas, n: Node): void {
    const t = n.text!;
    // An auto-width box is exactly as wide as its longest line; a hair more stops it wrapping.
    const width = t.sizing === 'autoWidth' ? n.width + 1 : n.width;
    const run = (paint: SkPaint) => { const p = this.paragraph(t, paint, width); c.drawParagraph(p, 0, 0); p.delete(); };
    if (t.background) this.drawLineBoxes(c, t, width);
    const stroke = (s: Stroke, w: number) => this.drawPaint(c, n, s.paint, p => {
      p.setStyle(this.ck.PaintStyle.Stroke);
      p.setStrokeWidth(w);
      p.setStrokeJoin(this.ck.StrokeJoin.Round);
      run(p);
    });
    for (const s of n.strokes) if (s.align === 'outside' && s.width > 0) stroke(s, s.width * 2);
    for (const f of n.fills) this.drawPaint(c, n, f, run);
    // ponytail: inside strokes draw centred on text; clipping to glyph outlines needs the glyph paths.
    for (const s of n.strokes) if (s.align !== 'outside' && s.width > 0) stroke(s, s.width);
  }

  /** One box per non-empty line, padded, behind the glyphs. */
  private drawLineBoxes(c: Canvas, t: TextProps, width: number): void {
    const bg = t.background!;
    const p = this.paragraph(t, null, width);
    const paint = new this.ck.Paint();
    paint.setAntiAlias(true);
    paint.setColor(this.ck.Color4f(bg.color.r, bg.color.g, bg.color.b, bg.color.a));
    const boxes = lineBoxes(p.getLineMetrics(), bg.padding);
    const b = bg.style === 'bubble' ? bubble(boxes, bg.padding, bg.tail?.show === false ? null : {
      at: bg.tail?.at ?? { left: 0, center: 0.5, right: 1 }[t.align],
      size: bg.tail?.size ?? Math.max(bg.padding, 12),
    }) : null;
    if (b) {
      // One path: its fill covers each pixel once, so a translucent colour doesn't double up where the tail meets the box.
      const pb = new this.ck.PathBuilder()
        .addRRect(this.ck.RRectXY(this.ck.XYWHRect(b.box.x, b.box.y, b.box.width, b.box.height), b.radius, b.radius));
      if (b.tail.length) pb.addPolygon(b.tail.flatMap(q => [q.x, q.y]), true);
      const path = pb.detachAndDelete();
      c.drawPath(path, paint);
      path.delete();
    }
    else for (const box of boxes) {
      const r = bg.style === 'pill' ? box.height / 2 : 0;
      c.drawRRect(this.ck.RRectXY(this.ck.XYWHRect(box.x, box.y, box.width, box.height), r, r), paint);
    }
    paint.delete();
    p.delete();
  }

  /** Fills, children (clipped for frames) and strokes, without effects. */
  private drawContent(c: Canvas, doc: Doc, n: Node, outline: SkPath | null): void {
    if (n.type === 'text' && n.text) return this.drawText(c, n);
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
    } else if (f.kind === 'image') {
      const img = this.image(f.assetId);
      if (!img) {
        p.setColor(this.color({ r: 0.5, g: 0.5, b: 0.5, a: 0.25 })); // placeholder while it loads
      } else {
        // Scale the picture to cover (fill) or fit inside the box, centred.
        const s = (f.scaleMode === 'fill' ? Math.max : Math.min)(n.width / img.width(), n.height / img.height());
        const tx = (n.width - img.width() * s) / 2, ty = (n.height - img.height() * s) / 2;
        shader = img.makeShaderOptions(this.ck.TileMode.Decal, this.ck.TileMode.Decal, this.ck.FilterMode.Linear, this.ck.MipmapMode.Linear, [s, 0, tx, 0, s, ty, 0, 0, 1]);
        p.setShader(shader);
      }
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
    // Safe zones first, under the selection: shaded strips on story-shaped boards.
    if (editor.safeZones) {
      this.fill.setColor(this.color(this.theme.accent, editor.safeZoneOpacity));
      for (const b of editor.doc.children(editor.pageId)) {
        if (b.type !== 'frame' || !b.visible || !isStoryShaped(b.width, b.height)) continue;
        const z = STORY_SAFE_ZONE, w = b.width, h = b.height;
        const m = editor.doc.worldTransform(b.id);
        const strips: Rect[] = [
          { x: 0, y: 0, width: w, height: h * z.top },
          { x: 0, y: h * (1 - z.bottom), width: w, height: h * z.bottom },
          { x: w * (1 - z.right), y: h * z.top, width: w * z.right, height: h * (1 - z.top - z.bottom) },
        ];
        for (const r of strips) {
          const pts = [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];
          const path = this.polygon(pts.map(q => camera.worldToScreen(apply(m, q))));
          c.drawPath(path, this.fill);
          path.delete();
        }
      }
    }

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
    // Typing: selection boxes and the caret, through the layer's transform.
    const te = editor.textEdit;
    const tn = te && editor.doc.get(te.nodeId);
    if (te && tn?.text) {
      const m = editor.doc.worldTransform(tn.id);
      const scr = (q: Point) => camera.worldToScreen(apply(m, q));
      const { caret, boxes } = this.textGeometry(tn, te.start, te.end);
      this.fill.setColor(this.color(this.theme.accent, 0.3));
      for (const b of boxes) {
        const path = this.polygon([scr({ x: b.x, y: b.y }), scr({ x: b.x + b.width, y: b.y }), scr({ x: b.x + b.width, y: b.y + b.height }), scr({ x: b.x, y: b.y + b.height })]);
        c.drawPath(path, this.fill);
        path.delete();
      }
      if (te.start === te.end) {
        const a = scr({ x: caret.x, y: caret.y }), b = scr({ x: caret.x, y: caret.y + caret.h });
        this.line.setStrokeWidth(2);
        c.drawLine(a.x, a.y, b.x, b.y, this.line);
        this.line.setStrokeWidth(1.5);
      }
    }

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

/** Padded boxes behind each line that has text (pure, for tests). */
export function lineBoxes(lines: { left: number; width: number; baseline: number; ascent: number; descent: number }[], pad: number): Rect[] {
  return lines.filter(l => l.width > 0).map(l => ({
    x: l.left - pad, y: l.baseline - l.ascent - pad / 2,
    width: l.width + pad * 2, height: l.ascent + l.descent + pad,
  }));
}

/**
 * One rounded box round every line, with an optional tail under it (pure, for tests).
 * The tail's base slides along the bottom between the corners (at 0–1); its tip leans out to the nearer side.
 */
export function bubble(boxes: Rect[], pad: number, tail: { at: number; size: number } | null): { box: Rect; radius: number; tail: Point[] } | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  const box = { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y + pad };
  const radius = Math.min(pad * 1.5, box.height / 2);
  if (!tail || tail.size <= 0) return { box, radius, tail: [] };
  const w = Math.min(tail.size, Math.max(0, box.width - radius * 2)), bottom = box.y + box.height;
  const at = Math.min(1, Math.max(0, tail.at));
  const start = box.x + radius + at * (box.width - radius * 2 - w);
  const tip = at < 0.5 ? start : at > 0.5 ? start + w : start + w / 2;
  return { box, radius, tail: [{ x: start, y: bottom - 1 }, { x: start + w, y: bottom - 1 }, { x: tip, y: bottom + tail.size }] };
}
