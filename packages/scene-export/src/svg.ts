// Nook board → SVG. Shapes, paths (with holes), groups, nested boards (clipped),
// solid and gradient fills and strokes, pictures, opacity, blend modes, drop
// shadows and layer blur map to plain SVG 1.1 + CSS. Booleans come in as their
// merged outline from the engine. What SVG can't carry is listed in the report.

import {
  contoursOf, isGradient, type Doc, type Node, type Outline, type Shadow, type Paint, type RGBA, type Stroke, type VectorPath,
} from '@nook/engine';

export interface SvgOptions {
  /** A layer's merged outline in its own space (the engine's; needed for booleans). */
  outline?: (n: Node) => { contours: VectorPath[]; fillRule: 'nonzero' | 'evenodd' } | null;
  /** A picture as a data: URL, by asset id (the app reads them before exporting). */
  image?: (assetId: string) => string | undefined;
}

export interface SvgExport { text: string; report: string[] }

const r = (v: number) => String(Math.round(v * 100) / 100);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rgb = (c: RGBA) => `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
const kebab = (s: string) => s.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);

/** SVG path data for contours (cubic per segment, Z when closed). */
export function pathData(paths: VectorPath[]): string {
  return paths.map(p => {
    const a = p.anchors;
    if (!a.length) return '';
    let d = `M${r(a[0]!.p.x)} ${r(a[0]!.p.y)}`;
    const seg = (s: typeof a[number], e: typeof a[number]) => {
      const straight = !s.out.x && !s.out.y && !e.in.x && !e.in.y;
      d += straight ? `L${r(e.p.x)} ${r(e.p.y)}`
        : `C${r(s.p.x + s.out.x)} ${r(s.p.y + s.out.y)} ${r(e.p.x + e.in.x)} ${r(e.p.y + e.in.y)} ${r(e.p.x)} ${r(e.p.y)}`;
    };
    for (let i = 1; i < a.length; i++) seg(a[i - 1]!, a[i]!);
    if (p.closed && a.length > 1) { seg(a[a.length - 1]!, a[0]!); d += 'Z'; }
    return d;
  }).join('');
}

export function exportSvg(doc: Doc, boardId: string, opts: SvgOptions = {}): SvgExport {
  const board = doc.get(boardId);
  if (!board) return { text: '', report: ['That board no longer exists.'] };
  const report: string[] = [];
  const defs: string[] = [];
  let nextId = 0;
  const id = (kind: string) => `${kind}${++nextId}`;
  const note = (msg: string) => { if (!report.includes(msg)) report.push(msg); };

  /** The node's shape as an SVG element with `attrs`, or null (text, groups). */
  function shape(n: Node, attrs: string): string | null {
    switch (n.type) {
      case 'frame':
      case 'rect': {
        const rad = Math.min(n.cornerRadius ?? 0, n.width / 2, n.height / 2);
        return `<rect width="${r(n.width)}" height="${r(n.height)}"${rad ? ` rx="${r(rad)}"` : ''}${attrs}/>`;
      }
      case 'ellipse':
        return `<ellipse cx="${r(n.width / 2)}" cy="${r(n.height / 2)}" rx="${r(n.width / 2)}" ry="${r(n.height / 2)}"${attrs}/>`;
      case 'boolean': {
        const o = opts.outline?.(n);
        if (!o?.contours.length) return null;
        return `<path d="${pathData(o.contours)}"${o.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : ''}${attrs}/>`;
      }
      default: {
        const paths = contoursOf(n);
        if (!paths.length) return null;
        return `<path d="${pathData(paths)}"${n.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : ''}${attrs}/>`;
      }
    }
  }

  /** A paint as fill/stroke attribute values (gradients go to <defs>, in the shape's unit box). */
  function paintRef(n: Node, p: Paint): { value: string; opacity: number } {
    if (p.kind === 'solid') return { value: rgb(p.color), opacity: p.color.a * p.opacity };
    if (isGradient(p)) {
      const gid = id('g');
      const stops = p.stops.map(s => `<stop offset="${r(s.offset)}" stop-color="${rgb(s.color)}"${s.color.a < 1 ? ` stop-opacity="${r(s.color.a)}"` : ''}/>`).join('');
      // Unit-box points, like Nook's; a boolean's box is its outline's, which can differ from Nook's (its children's).
      defs.push(p.kind === 'linear'
        ? `<linearGradient id="${gid}" x1="${r(p.from.x)}" y1="${r(p.from.y)}" x2="${r(p.to.x)}" y2="${r(p.to.y)}">${stops}</linearGradient>`
        : `<radialGradient id="${gid}" cx="${r(p.from.x)}" cy="${r(p.from.y)}" r="${r(Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y))}">${stops}</radialGradient>`);
      return { value: `url(#${gid})`, opacity: p.opacity };
    }
    return { value: 'none', opacity: 0 };
  }

  const blendStyle = (p: { blendMode: string }) => (p.blendMode !== 'normal' ? ` style="mix-blend-mode:${kebab(p.blendMode)}"` : '');

  /** Fills (bottom to top), then strokes, of one shape-like node. */
  function paints(n: Node): string {
    let out = '';
    let clipId: string | null = null;
    const clip = () => {
      if (clipId) return clipId;
      const s = shape(n, '');
      if (!s) return null;
      clipId = id('c');
      defs.push(`<clipPath id="${clipId}">${s}</clipPath>`);
      return clipId;
    };
    for (const f of n.fills) {
      if (!f.visible) continue;
      if (f.kind === 'image') {
        const href = opts.image?.(f.assetId);
        const c = clip();
        if (!href || !c) { note(`"${n.name}": a picture couldn't be read, so it was left out.`); continue; }
        const ar = f.scaleMode === 'fill' ? 'xMidYMid slice' : 'xMidYMid meet';
        out += `<image href="${href}" width="${r(n.width)}" height="${r(n.height)}" preserveAspectRatio="${ar}" clip-path="url(#${c})"${f.opacity < 1 ? ` opacity="${r(f.opacity)}"` : ''}${blendStyle(f)}/>`;
        continue;
      }
      const { value, opacity } = paintRef(n, f);
      out += shape(n, ` fill="${value}"${opacity < 1 ? ` fill-opacity="${r(opacity)}"` : ''}${blendStyle(f)}`) ?? '';
    }
    for (const s of n.strokes) out += stroke(n, s, clip);
    return out;
  }

  /** Strokes: inside ones are drawn twice as wide and clipped to the shape; outside ones are drawn centred (reported). */
  function stroke(n: Node, s: Stroke, clip: () => string | null): string {
    if (!s.paint.visible || s.width <= 0 || s.paint.kind === 'image') return '';
    const { value, opacity } = paintRef(n, s.paint);
    const inside = s.align === 'inside' ? clip() : null;
    if (s.align === 'outside') note(`"${n.name}": outside strokes are drawn centred in SVG.`);
    const width = inside ? s.width * 2 : s.width;
    const attrs = ` fill="none" stroke="${value}" stroke-width="${r(width)}" stroke-linejoin="round"${opacity < 1 ? ` stroke-opacity="${r(opacity)}"` : ''}`;
    const el = shape(n, attrs) ?? '';
    return inside ? `<g clip-path="url(#${inside})">${el}</g>` : el;
  }

  /** Sticker outline, drop shadows and a layer blur as one filter (in Nook's order); the rest are reported. */
  function filter(n: Node): string {
    const fx = n.effects.filter(e => e.visible);
    const shadows = fx.filter((e): e is Shadow => e.kind === 'dropShadow');
    const blur = fx.find(e => e.kind === 'layerBlur');
    const outline = fx.find((e): e is Outline => e.kind === 'outline' && e.width > 0);
    for (const e of fx) {
      if (e.kind !== 'dropShadow' && e.kind !== 'layerBlur' && e.kind !== 'outline') note(`"${n.name}": ${kebab(e.kind).replace(/-/g, ' ')} isn't in SVG export, so it was left out.`);
      if (e.kind === 'dropShadow' && e.spread) note(`"${n.name}": drop shadow spread isn't in SVG export.`);
    }
    if (!shadows.length && !blur && !outline) return '';
    const fid = id('f');
    let body = '';
    // The outline as Nook draws it: grow the alpha, blur it, snap it back to a hard edge, fill with the colour.
    if (outline) {
      const w = outline.width;
      body += `<feMorphology in="SourceAlpha" operator="dilate" radius="${r(w * 0.8)}"/><feGaussianBlur stdDeviation="${r(w * 0.35)}"/>`
        + `<feComponentTransfer result="oa"><feFuncA type="linear" slope="8" intercept="-3.5"/></feComponentTransfer>`
        + `<feFlood flood-color="${rgb(outline.color)}" flood-opacity="${r(outline.color.a)}"/><feComposite in2="oa" operator="in" result="ol"/>`;
    }
    shadows.forEach((e, i) => {
      body += `<feGaussianBlur in="SourceAlpha" stdDeviation="${r(e.blur / 2)}"/><feOffset dx="${r(e.x)}" dy="${r(e.y)}" result="o${i}"/>`
        + `<feFlood flood-color="${rgb(e.color)}" flood-opacity="${r(e.color.a)}"/><feComposite in2="o${i}" operator="in" result="s${i}"/>`;
    });
    body += `<feMerge>${outline ? '<feMergeNode in="ol"/>' : ''}${shadows.map((_, i) => `<feMergeNode in="s${i}"/>`).join('')}<feMergeNode in="SourceGraphic"/></feMerge>`;
    if (blur && blur.kind === 'layerBlur') body += `<feGaussianBlur stdDeviation="${r(blur.radius / 2)}"/>`;
    defs.push(`<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%">${body}</filter>`);
    return ` filter="url(#${fid})"`;
  }

  function text(n: Node): string {
    const t = n.text!;
    if (t.background) note(`"${n.name}": text backgrounds aren't in SVG export yet.`);
    note('Text is exported as SVG text: it needs the same fonts installed, and long lines may wrap differently.');
    const lh = t.lineHeight ?? t.size * 1.2;
    const x = t.align === 'left' ? 0 : t.align === 'center' ? n.width / 2 : n.width;
    const anchor = t.align === 'left' ? 'start' : t.align === 'center' ? 'middle' : 'end';
    const lines = t.content.split('\n');
    const fill = n.fills.filter(f => f.visible && f.kind !== 'image').at(-1);
    const { value, opacity } = fill ? paintRef(n, fill) : { value: 'none', opacity: 1 };
    // First baseline: half the leading plus about 0.8 em of ascent.
    const tspans = lines.map((line, i) => `<tspan x="${r(x)}" y="${r((lh - t.size) / 2 + t.size * 0.8 + i * lh)}">${esc(line) || ' '}</tspan>`).join('');
    return `<text font-family="${esc(`'${t.family}', sans-serif`)}" font-weight="${t.weight}" font-size="${r(t.size)}"${t.letterSpacing ? ` letter-spacing="${r(t.letterSpacing)}"` : ''} text-anchor="${anchor}" fill="${value}"${opacity < 1 ? ` fill-opacity="${r(opacity)}"` : ''}>${tspans}</text>`;
  }

  function layer(n: Node): string {
    if (!n.visible) return '';
    const t = n.transform;
    const attrs = ` transform="matrix(${t.map(r).join(' ')})"${n.opacity < 1 ? ` opacity="${r(n.opacity)}"` : ''}${filter(n)}${blendStyle(n)}`;
    const name = ` data-name="${esc(n.name)}"`;
    let body: string;
    switch (n.type) {
      case 'group':
        if (n.maskMode) {
          // The top child as a luminance mask of its alpha: drawn white, so opaque shows (black for inverted).
          const kids = doc.children(n.id);
          const m = kids.at(-1), content = kids.slice(0, -1);
          const mid = id('m');
          const box = { w: board!.width * 4, h: board!.height * 4 };
          const white = m ? layer({ ...m, visible: true }).replace(/fill="[^"]*"/g, 'fill="#fff"').replace(/stroke="[^"]*"/g, 'stroke="#fff"') : '';
          const inner = n.maskMode === 'inverted'
            ? `<rect x="${r(-box.w)}" y="${r(-box.h)}" width="${r(box.w * 2)}" height="${r(box.h * 2)}" fill="#fff"/>${white.replace(/#fff/g, '#000')}`
            : white;
          defs.push(`<mask id="${mid}" maskUnits="userSpaceOnUse" x="${r(-box.w)}" y="${r(-box.h)}" width="${r(box.w * 2)}" height="${r(box.h * 2)}">${inner}</mask>`);
          if (m && (m.type === 'text' || m.fills.some(f => f.kind !== 'solid'))) note(`"${n.name}": its mask is exported by shape; gradient or picture transparency in the mask isn't kept in SVG.`);
          body = `<g mask="url(#${mid})">${content.map(layer).join('')}</g>`;
        } else body = doc.children(n.id).map(layer).join('');
        break;
      case 'frame': {
        let kids = doc.children(n.id).map(layer).join('');
        if (n.clipContent !== false) {
          const cid = id('c');
          defs.push(`<clipPath id="${cid}">${shape(n, '')}</clipPath>`);
          kids = `<g clip-path="url(#${cid})">${kids}</g>`;
        }
        body = paints({ ...n, strokes: [] }) + kids + n.strokes.map(s => stroke(n, s, () => null)).join('');
        break;
      }
      case 'text':
        body = text(n);
        break;
      case 'boolean':
        if (!opts.outline) note(`"${n.name}": booleans need the editor to export; its shapes were exported unmerged.`);
        body = opts.outline ? paints(n) : doc.children(n.id).map(layer).join('');
        break;
      default:
        body = paints(n);
    }
    return `<g${name}${attrs}>${body}</g>`;
  }

  // The board is the canvas: its own fills are the background, its children the content.
  const content = doc.children(board.id).map(layer).join('');
  const background = paints({ ...board, strokes: [] });
  const w = r(board.width), h = r(board.height);
  const text_ = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<title>${esc(board.name)}</title>${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${background}${content}</svg>\n`;
  return { text: text_, report };
}
