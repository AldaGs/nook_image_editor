// Pasted or dropped SVG. Plain shapes (path, rect, circle, ellipse, line,
// polyline, polygon) with flat colours become editable vector layers. A drawing
// with anything the editor can't hold as vectors (text, pictures, gradients,
// patterns, filters, masks, <use>) comes in as a picture instead, so it still
// looks right. Clip paths are ignored (Figma wraps every copy in one).

import { solid, type Engine, type Paint, type RGBA, type Stroke, type VectorShape } from '@nook/engine';

const NS = 'http://www.w3.org/2000/svg';
const SHAPES = 'path,rect,circle,ellipse,line,polyline,polygon';
const PICTURE_ONLY = 'text,image,use,foreignObject,filter,mask,pattern,linearGradient,radialGradient';
const SKIP_INSIDE = 'defs,clipPath,mask,symbol,marker,pattern';

/** SVG markup in a paste (Figma and Illustrator copy it as text), or ''. */
export function svgText(data: DataTransfer | null): string {
  const t = (data?.getData('image/svg+xml') || data?.getData('text/plain') || '').trim();
  return t.startsWith('<') && /<svg[\s>]/i.test(t) ? t : '';
}

/** Parse SVG text; the root <svg>, or null if it isn't one. */
function parse(text: string): SVGSVGElement | null {
  // Pasted snippets often leave out the namespace, which makes them plain XML.
  if (!/<svg[^>]*\sxmlns=/i.test(text)) text = text.replace(/<svg\b/i, `<svg xmlns="${NS}"`);
  const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
  return root instanceof SVGSVGElement ? root : null;
}

/**
 * The drawing's shapes in its own units (the viewBox), or null when it needs
 * to come in as a picture (or has no shapes).
 */
export function svgShapes(engine: Engine, text: string): VectorShape[] | null {
  const root = parse(text);
  if (!root || root.querySelector(PICTURE_ONLY)) return null;
  // Computed styles (classes, <style>) and transforms need it in the page. It
  // stays inert: scripts and on* handlers are stripped, and it's invisible.
  root.querySelectorAll('script').forEach(s => s.remove());
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const a of [...el.attributes]) if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
  }
  root.querySelectorAll('style').forEach(s => { s.textContent = (s.textContent ?? '').replace(/@import[^;]*;?/g, ''); });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none';
  host.append(root);
  document.body.append(host);
  try {
    const toRoot = root.getScreenCTM()?.inverse();
    if (!toRoot) return null;
    const out: VectorShape[] = [];
    for (const el of root.querySelectorAll<SVGGraphicsElement>(SHAPES)) {
      if (el.closest(SKIP_INSIDE)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility !== 'visible') continue;
      const d = pathData(el);
      const ctm = el.getScreenCTM();
      if (!d || !ctm) continue;
      const m = toRoot.multiply(ctm);
      const fill = paint(cs.fill, +cs.fillOpacity), stroke = paint(cs.stroke, +cs.strokeOpacity);
      if (fill === undefined || stroke === undefined) return null; // a gradient or pattern paint
      const width = parseFloat(cs.strokeWidth) * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
      const contours = engine.svgContours(d, [m.a, m.b, m.c, m.d, m.e, m.f]);
      if (!contours?.length || (!fill && !(stroke && width > 0))) continue;
      const strokes: Stroke[] = stroke && width > 0 ? [{ paint: stroke, width, align: 'center' }] : [];
      out.push({ name: el.id || 'Vector', contours, fillRule: cs.fillRule === 'evenodd' ? 'evenodd' : 'nonzero', fills: fill ? [fill] : [], strokes, opacity: opacityOf(el, root) });
    }
    return out.length ? out : null;
  } finally {
    host.remove();
  }
}

/** A drawing drawn as a PNG at twice its size (at most 4096 px a side), for when vectors won't do. */
export async function svgPicture(text: string, name: string): Promise<File> {
  const root = parse(text);
  if (!root) throw new Error('not an SVG drawing');
  const vb = root.viewBox.baseVal;
  const w = parseFloat(root.getAttribute('width') ?? '') || vb?.width || 300;
  const h = parseFloat(root.getAttribute('height') ?? '') || vb?.height || 150;
  const s = Math.min(2, 4096 / Math.max(w, h));
  root.setAttribute('width', String(w * s));
  root.setAttribute('height', String(h * s));
  // As an <img> the SVG is sandboxed: no scripts, no outside requests.
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = new OffscreenCanvas(Math.round(w * s), Math.round(h * s));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return new File([await canvas.convertToBlob({ type: 'image/png' })], `${name}.png`, { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A shape element's outline as path data. */
function pathData(el: Element): string | null {
  const n = (a: string) => parseFloat(el.getAttribute(a) ?? '') || 0;
  switch (el.localName) {
    case 'path': return el.getAttribute('d');
    case 'line': return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`;
    case 'polyline': case 'polygon': {
      const pts = el.getAttribute('points')?.trim();
      return pts ? `M${pts}${el.localName === 'polygon' ? 'z' : ''}` : null;
    }
    case 'circle': case 'ellipse': {
      const cx = n('cx'), cy = n('cy');
      const rx = el.localName === 'circle' ? n('r') : n('rx'), ry = el.localName === 'circle' ? n('r') : n('ry');
      return rx > 0 && ry > 0 ? `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z` : null;
    }
    case 'rect': {
      const x = n('x'), y = n('y'), w = n('width'), h = n('height');
      if (w <= 0 || h <= 0) return null;
      let rx = el.hasAttribute('rx') ? n('rx') : n('ry'), ry = el.hasAttribute('ry') ? n('ry') : rx;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (!rx || !ry) return `M${x} ${y}h${w}v${h}h${-w}z`;
      const a = (dx: number, dy: number) => `a${rx} ${ry} 0 0 1 ${dx} ${dy}`;
      return `M${x + rx} ${y}h${w - 2 * rx}${a(rx, ry)}v${h - 2 * ry}${a(-rx, ry)}h${2 * rx - w}${a(-rx, -ry)}v${2 * ry - h}${a(rx, -ry)}z`;
    }
  }
  return null;
}

/** A computed fill or stroke: a solid paint, null for none, undefined for one we can't hold (url()). */
function paint(css: string, opacity: number): Paint | null | undefined {
  if (!css || css === 'none') return null;
  const c = rgba(css);
  if (!c) return undefined;
  c.a *= Number.isFinite(opacity) ? opacity : 1;
  return c.a > 0 ? solid(c) : null;
}

/** 'rgb(255, 0, 0)' / 'rgba(…)' as 0–1 floats. */
function rgba(css: string): RGBA | null {
  const m = /^rgba?\(([^)]+)\)$/.exec(css.trim());
  if (!m) return null;
  const [r, g, b, a = '1'] = m[1]!.split(/[\s,/]+/).filter(Boolean);
  const alpha = a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
  return { r: +r! / 255, g: +g! / 255, b: +b! / 255, a: alpha };
}

/** The element's opacity times its groups' (CSS opacity doesn't inherit). */
function opacityOf(el: Element, root: Element): number {
  let o = 1;
  for (let e: Element | null = el; e && e !== root; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity) || 0;
  return o;
}
