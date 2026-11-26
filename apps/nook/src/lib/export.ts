import { exportSvg } from '@nook/scene-export';
import { usedAssets, type Doc } from '@nook/engine';
import { loadAsset } from './assets';
// Boards as image files: the engine draws each board's pixels, the browser
// encodes them (CanvasKit here only encodes PNG). Files are numbered in board
// order so a shared set lands as a carousel in the right order.

import type { Engine, Node } from '@nook/engine';

export type ImageFormat = 'png' | 'jpeg' | 'webp';

/** iOS refuses canvases over this many pixels; bigger exports would fail there. */
export const MAX_PIXELS = 4096 * 4096;

export const fitsLimit = (b: Node, scale: number) => Math.round(b.width * scale) * Math.round(b.height * scale) <= MAX_PIXELS;

let webp: Promise<boolean> | null = null;
/** Whether this browser can write WebP (Safari, for one, can't everywhere). */
export function canEncodeWebp(): Promise<boolean> {
  webp ??= (() => {
    const c = new OffscreenCanvas(1, 1);
    c.getContext('2d'); // a canvas can only encode once it has a context
    return c.convertToBlob({ type: 'image/webp' }).then(b => b.type === 'image/webp').catch(() => false);
  })();
  return webp;
}

export async function encode(px: { width: number; height: number; pixels: Uint8Array }, format: ImageFormat): Promise<Blob> {
  const canvas = new OffscreenCanvas(px.width, px.height);
  const ctx = canvas.getContext('2d')!;
  // A view, not a copy: at 3x a board is tens of megabytes. CanvasKit hands back a plain ArrayBuffer.
  const data = new ImageData(new Uint8ClampedArray(px.pixels.buffer as ArrayBuffer, px.pixels.byteOffset, px.pixels.byteLength), px.width, px.height);
  if (format === 'jpeg') {
    // JPEG has no transparency: composite onto white, not the black a bare encode would give.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, px.width, px.height);
    const bmp = await createImageBitmap(data);
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
  } else {
    ctx.putImageData(data, 0, 0);
  }
  return canvas.convertToBlob({ type: `image/${format}`, quality: 0.92 });
}

/** Boards as SVG files: pictures embedded, booleans as their merged outline. Returns the files and what SVG left out. */
export async function boardSvgs(engine: Engine, boards: Node[], doc: Doc): Promise<{ files: File[]; report: string[] }> {
  const urls = new Map<string, string>();
  for (const id of usedAssets(doc)) {
    const bytes = await loadAsset(id);
    if (!bytes) continue;
    const type = new Uint8Array(bytes, 0, 2)[0] === 0xff ? 'image/jpeg' : 'image/png';
    urls.set(id, await new Promise<string>(res => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result as string);
      fr.readAsDataURL(new Blob([bytes], { type }));
    }));
  }
  const files: File[] = [];
  const report = new Set<string>();
  for (const [i, b] of boards.entries()) {
    const out = exportSvg(doc, b.id, { outline: n => engine.outline(n.id), image: id => urls.get(id) });
    out.report.forEach(r => report.add(r));
    const prefix = boards.length > 1 ? `${String(i + 1).padStart(2, '0')} ` : '';
    files.push(new File([out.text], `${prefix}${safeName(b.name)}.svg`, { type: 'image/svg+xml' }));
  }
  return { files, report: [...report] };
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Board';

/** Render and encode boards, one file each, named "01 Board name.png" in order. */
export async function boardFiles(engine: Engine, boards: Node[], scale: number, format: ImageFormat): Promise<File[]> {
  const ext = format === 'jpeg' ? 'jpg' : format;
  const files: File[] = [];
  for (const [i, b] of boards.entries()) {
    const px = await engine.renderBoard(b.id, scale);
    if (!px) throw new Error(`"${b.name}" is too big to export at ${scale}x on this device`);
    const blob = await encode(px, format);
    const prefix = boards.length > 1 ? `${String(i + 1).padStart(2, '0')} ` : '';
    files.push(new File([blob], `${prefix}${safeName(b.name)}.${ext}`, { type: blob.type }));
  }
  return files;
}
