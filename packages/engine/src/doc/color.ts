// Colour maths for the picker: hex in and out, HSV for the square and hue
// slider, and the colours a document already uses.

import type { Doc } from './document.ts';
import type { Paint, RGBA } from './types.ts';

/** Hue 0–360, saturation and value 0–1, alpha 0–1. */
export interface HSVA { h: number; s: number; v: number; a: number }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const hex2 = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');

/** `#rrggbb`, or `#rrggbbaa` when `withAlpha` and the colour isn't opaque. */
export function toHex(c: RGBA, withAlpha = false): string {
  const rgb = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return withAlpha && c.a < 1 ? rgb + hex2(c.a) : rgb;
}

/** Parse `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` (the # is optional); null if it isn't one. */
export function parseHex(text: string): RGBA | null {
  let h = text.trim().replace(/^#/, '');
  if (!/^[0-9a-f]+$/i.test(h) || ![3, 4, 6, 8].includes(h.length)) return null;
  if (h.length <= 4) h = [...h].map(ch => ch + ch).join('');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
}

export function rgbToHsv(c: RGBA): HSVA {
  const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b), d = max - min;
  let h = 0;
  if (d) {
    if (max === c.r) h = ((c.g - c.b) / d) % 6;
    else if (max === c.g) h = (c.b - c.r) / d + 2;
    else h = (c.r - c.g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max, a: c.a };
}

export function hsvToRgb({ h, s, v, a }: HSVA): RGBA {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: f(5), g: f(3), b: f(1), a };
}

/** Colours the document's paints use (solids and gradient stops), most used first. */
export function documentColors(doc: Doc, limit = 12): RGBA[] {
  const counts = new Map<string, { c: RGBA; n: number }>();
  const add = (c: RGBA) => {
    const key = toHex(c, true);
    const e = counts.get(key);
    if (e) e.n++;
    else counts.set(key, { c, n: 1 });
  };
  const paint = (p: Paint) => (p.kind === 'solid' ? add(p.color) : p.kind === 'image' ? undefined : p.stops.forEach(s => add(s.color)));
  for (const n of doc.nodes.values()) {
    if (n.type === 'page') continue;
    n.fills.forEach(paint);
    n.strokes.forEach(s => paint(s.paint));
    for (const e of n.effects) if (e.kind === 'dropShadow' || e.kind === 'innerShadow') add(e.color);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, limit).map(e => e.c);
}
