// .nook files: a zip of `doc.json` and `assets/<id>` (the pictures it uses),
// for backing up a document or moving it to another device.

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { fromFile, toFile, usedAssets, type Doc } from '@nook/engine';

const ASSET = /^assets\/([0-9a-f]{32})$/;

/** The document and its pictures as a .nook file. Pictures are stored as-is (already compressed). */
export async function saveNook(doc: Doc, loadAsset: (id: string) => Promise<ArrayBuffer | null>, name = 'Nook board'): Promise<File> {
  const entries: Zippable = { 'doc.json': [strToU8(JSON.stringify(toFile(doc))), { level: 6 }] };
  for (const id of usedAssets(doc)) {
    const bytes = await loadAsset(id);
    if (bytes) entries[`assets/${id}`] = [new Uint8Array(bytes), { level: 0 }];
  }
  return new File([zipSync(entries)], `${name}.nook`, { type: 'application/zip' });
}

/**
 * Read a .nook file: its pictures go to `putAsset` (stored on this device), and
 * the document is returned for the editor to load. Throws on anything that isn't one.
 */
export async function openNook(file: Blob, putAsset: (id: string, bytes: Uint8Array) => Promise<void>): Promise<Doc> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('not a .nook file');
  }
  const json = files['doc.json'];
  if (!json) throw new Error('not a .nook file (no doc.json inside)');
  const doc = fromFile(JSON.parse(strFromU8(json))); // checks the format and version
  // Only well-formed asset ids are taken; anything else in the zip is ignored.
  for (const [path, bytes] of Object.entries(files)) {
    const id = ASSET.exec(path)?.[1];
    if (id) await putAsset(id, bytes);
  }
  return doc;
}
