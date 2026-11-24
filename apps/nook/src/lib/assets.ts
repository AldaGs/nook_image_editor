// Image assets: picked, dropped or pasted pictures, stored once on the device
// (OPFS `assets/<hash>`) and referred to by that content hash from the document.
//
// Every import is redrawn through a canvas, which bakes in the camera's EXIF
// rotation, strips metadata (GPS location included, which matters for photos
// you post), and caps the size at MAX_SIDE so iPhones don't run out of GPU memory.

import type { Editor, Point } from '@nook/engine';
import { readFile, writeFile } from '@nook/storage';
import { canvasRef, editor, ui } from './session.svelte';

const MAX_SIDE = 4096;
const memory = new Map<string, ArrayBuffer>();

export interface StoredImage { assetId: string; width: number; height: number }

const isImage = (f: File) => f.type.startsWith('image/');

/** Normalize, hash and store one picture; returns its id and pixel size. */
export async function storeImage(file: Blob): Promise<StoredImage> {
  const bitmap = await createImageBitmap(file); // applies EXIF orientation
  const s = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * s)), height = Math.max(1, Math.round(bitmap.height * s));
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  // Photos stay JPEG; anything that may have transparency becomes PNG.
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const bytes = await (await canvas.convertToBlob({ type, quality: 0.92 })).arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const assetId = [...digest.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
  memory.set(assetId, bytes);
  if (!(await readFile(`assets/${assetId}`))) await writeFile(`assets/${assetId}`, bytes);
  return { assetId, width, height };
}

/** An image file by id, for the renderer. */
export async function loadAsset(id: string): Promise<ArrayBuffer | null> {
  const hit = memory.get(id);
  if (hit) return hit;
  const file = await readFile(`assets/${id}`);
  if (!file) return null;
  const bytes = await file.arrayBuffer();
  memory.set(id, bytes);
  return bytes;
}

/**
 * Add pictures to the document at a world point (on a board: fitted inside it).
 * Several pictures fan out a little so none hides another. Selects what was added.
 */
export async function addImages(editor: Editor, files: Iterable<File>, at: Point): Promise<number> {
  const ids: string[] = [];
  let i = 0;
  for (const file of files) {
    if (!isImage(file)) continue;
    const img = await storeImage(file);
    const name = file.name.replace(/\.[^.]+$/, '') || 'Image';
    const node = editor.addImage(img, name, { x: at.x + i * 40, y: at.y + i * 40 });
    ids.push(node.id);
    i++;
  }
  if (ids.length) editor.select(ids);
  return ids.length;
}

/**
 * Import pictures where the user put them: at a drop point (client px), or the
 * middle of the view. Errors (an unreadable file) show as the app's toast.
 */
export async function importImages(files: File[], client?: Point): Promise<void> {
  const { engine, canvas } = canvasRef;
  if (!engine || !canvas || !files.length) return;
  const r = canvas.getBoundingClientRect();
  const screen = client ? { x: client.x - r.left, y: client.y - r.top } : { x: r.width / 2, y: r.height / 2 };
  try {
    await addImages(editor, files, engine.camera.screenToWorld(screen));
  } catch (e) {
    ui.error = `Couldn't add that picture: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Image files in a drop or paste. */
export const imageFiles = (list: FileList | null | undefined): File[] => [...(list ?? [])].filter(isImage);
