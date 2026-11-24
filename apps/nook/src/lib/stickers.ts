// The sticker library: a built-in starter pack (flat SVG drawings, made for
// Nook) and stickers you save from picture layers. Both go into the document
// as an ordinary picture layer with a sticker outline and a soft shadow.

import { newEffect, type Effect, type ImagePaint, type Node } from '@nook/engine';
import { readFile, writeFile } from '@nook/storage';
import { storeImage } from './assets';
import { canvasRef, editor, ui } from './session.svelte';

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;

export const STARTERS: { name: string; svg: string }[] = [
  { name: 'Heart', svg: svg('<path d="M50 86C20 66 8 50 8 33a20 20 0 0 1 42-10 20 20 0 0 1 42 10c0 17-12 33-42 53z" fill="#ff4d6d"/><ellipse cx="30" cy="30" rx="7" ry="4" fill="#fff" opacity=".5" transform="rotate(-35 30 30)"/>') },
  { name: 'Star', svg: svg('<path d="M50 6l12.6 28 30.4 3.2-22.8 20.4 6.6 30L50 72.2 23.2 87.6l6.6-30L7 37.2l30.4-3.2z" fill="#ffc93c" stroke="#f29e00" stroke-width="3" stroke-linejoin="round"/>') },
  { name: 'Sparkle', svg: svg('<path d="M50 4c4 26 20 42 46 46-26 4-42 20-46 46-4-26-20-42-46-46 26-4 42-20 46-46z" fill="#8ecae6"/><path d="M82 8c1.5 8 5 11.5 13 13-8 1.5-11.5 5-13 13-1.5-8-5-11.5-13-13 8-1.5 11.5-5 13-13z" fill="#ffd166"/>') },
  { name: 'Smile', svg: svg('<circle cx="50" cy="50" r="44" fill="#ffd23f"/><circle cx="35" cy="40" r="6" fill="#3d2c1e"/><circle cx="65" cy="40" r="6" fill="#3d2c1e"/><path d="M28 58q22 24 44 0" fill="none" stroke="#3d2c1e" stroke-width="7" stroke-linecap="round"/>') },
  { name: 'Bolt', svg: svg('<path d="M58 4L16 58h28l-8 38 48-58H54z" fill="#ffe14d" stroke="#1d1d1f" stroke-width="4" stroke-linejoin="round"/>') },
  { name: 'Sun', svg: svg('<g stroke="#ff9f1c" stroke-width="7" stroke-linecap="round"><path d="M50 6v12M50 82v12M6 50h12M82 50h12M19 19l8 8M73 73l8 8M19 81l8-8M73 27l8-8"/></g><circle cx="50" cy="50" r="22" fill="#ffbf1f"/>') },
  { name: 'Flower', svg: svg('<g fill="#ff8fab"><circle cx="50" cy="24" r="18"/><circle cx="76" cy="43" r="18"/><circle cx="66" cy="74" r="18"/><circle cx="34" cy="74" r="18"/><circle cx="24" cy="43" r="18"/></g><circle cx="50" cy="51" r="15" fill="#ffd23f"/>') },
  { name: 'Crown', svg: svg('<path d="M10 76L6 26l24 20L50 14l20 32 24-20-4 50z" fill="#ffc300" stroke="#c98a00" stroke-width="3" stroke-linejoin="round"/><rect x="10" y="76" width="80" height="12" rx="3" fill="#e0a100"/><circle cx="50" cy="56" r="6" fill="#e63946"/>') },
  { name: 'Fire', svg: svg('<path d="M50 96C26 96 14 80 14 62c0-20 16-28 18-46 10 8 14 18 12 28 6-4 10-12 10-22 18 12 32 28 32 46 0 16-12 28-36 28z" fill="#ff6b35"/><path d="M50 96c-10 0-17-7-17-16 0-10 9-14 11-24 10 6 23 14 23 25 0 9-7 15-17 15z" fill="#ffd166"/>') },
  { name: 'Arrow', svg: svg('<path d="M8 40h52V18l34 32-34 32V60H8z" fill="#06d6a0" stroke="#048a67" stroke-width="3" stroke-linejoin="round"/>') },
  { name: 'Wow', svg: svg('<path d="M50 3l9 16 17-8 1 19 19 2-9 17 13 13-18 6 3 19-18-4-8 17-9-16-17 9-2-19-19-1 9-17-14-13 18-7-3-18 19 3z" fill="#ff006e"/><text x="50" y="58" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="24" fill="#fff" text-anchor="middle">WOW</text>') },
  { name: 'Speech', svg: svg('<path d="M14 10h72a10 10 0 0 1 10 10v40a10 10 0 0 1-10 10H44L24 90l4-20H14A10 10 0 0 1 4 60V20a10 10 0 0 1 10-10z" fill="#fff" stroke="#1d1d1f" stroke-width="4" stroke-linejoin="round"/><circle cx="30" cy="40" r="5" fill="#1d1d1f"/><circle cx="50" cy="40" r="5" fill="#1d1d1f"/><circle cx="70" cy="40" r="5" fill="#1d1d1f"/>') },
];

export const svgUrl = (s: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;

/** A saved sticker: a picture layer's image, look and size. */
export interface SavedSticker { name: string; fill: ImagePaint; effects: Effect[]; width: number; height: number }

const FILE = 'stickers.json';

export async function loadSaved(): Promise<SavedSticker[]> {
  try {
    const f = await readFile(FILE);
    return f ? (JSON.parse(await f.text()) as SavedSticker[]) : [];
  } catch {
    return [];
  }
}

const store = (list: SavedSticker[]) => writeFile(FILE, JSON.stringify(list));

/** Save a picture layer (its top picture fill) to the library. False if it has no picture. */
export async function saveSticker(n: Node): Promise<boolean> {
  const fill = [...n.fills].reverse().find((p): p is ImagePaint => p.kind === 'image');
  if (!fill) return false;
  await store([{ name: n.name, fill, effects: n.effects, width: n.width, height: n.height }, ...(await loadSaved())]);
  return true;
}

export async function removeSaved(i: number): Promise<void> {
  const list = await loadSaved();
  list.splice(i, 1);
  await store(list);
}

const STICKER_FX = (): Effect[] => [
  newEffect('outline'),
  { kind: 'dropShadow', visible: true, color: { r: 0, g: 0, b: 0, a: 0.25 }, x: 0, y: 6, blur: 16, spread: 0 },
];

/** Add a picture in the middle of the view, at most `size` across, with these effects. Selects it. */
function place(img: { assetId: string; width: number; height: number }, name: string, effects: Effect[], size: { width: number; height: number }): void {
  const { engine, canvas } = canvasRef;
  if (!engine || !canvas) return;
  const r = canvas.getBoundingClientRect();
  const node = editor.addImage(img, name, engine.camera.screenToWorld({ x: r.width / 2, y: r.height / 2 }));
  // addImage fits the picture to its board; shrink it to sticker size about its centre.
  const s = Math.min(1, size.width / node.width, size.height / node.height);
  const width = Math.round(node.width * s), height = Math.round(node.height * s);
  const [a, b, c, d, e, f] = node.transform;
  const transform = [a, b, c, d, e + (node.width - width) / 2, f + (node.height - height) / 2];
  editor.transact('Add sticker', () => [
    { t: 'set', id: node.id, prop: 'width', value: width },
    { t: 'set', id: node.id, prop: 'height', value: height },
    { t: 'set', id: node.id, prop: 'transform', value: transform },
    { t: 'set', id: node.id, prop: 'effects', value: effects },
  ]);
  editor.select([node.id]);
}

/** Draw a starter SVG to a 512 px PNG (createImageBitmap can't read SVG everywhere), store and place it. */
export async function addStarter(s: { name: string; svg: string }): Promise<void> {
  try {
    const img = new Image();
    img.src = svgUrl(s.svg);
    await img.decode();
    const canvas = new OffscreenCanvas(512, 512);
    canvas.getContext('2d')!.drawImage(img, 0, 0, 512, 512);
    const stored = await storeImage(await canvas.convertToBlob({ type: 'image/png' }));
    place(stored, s.name, STICKER_FX(), { width: 320, height: 320 });
  } catch (e) {
    ui.error = `Couldn't add that sticker: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export function addSaved(s: SavedSticker): void {
  place(s.fill, s.name, s.effects, { width: s.width, height: s.height });
}
