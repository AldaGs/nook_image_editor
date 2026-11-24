// Model loading, ported from Heirloom. `loadModel` is the only way to get a model:
// it refuses while AI is off and only fetches from this app's own origin.

import { aiEnabled, AiDisabledError, onAiCleared } from './switch.ts';

/** AI files get their own Cache Storage bucket so "Remove AI data" drops exactly them. */
export const AI_CACHE = 'nook-ai';

/**
 * Same-origin model files, fetched into public/models by `pnpm fetch-models`.
 * The user picks one in Settings. IS-Net runs anywhere; BiRefNet needs a GPU
 * with enough room and falls back to IS-Net where it can't run.
 */
export const MODELS = {
  isnet: {
    file: 'models/isnet-general-use.onnx',
    name: 'IS-Net',
    about: 'Runs on any device, phones included',
    mb: 179,
    license: 'Apache-2.0 — Xuebin Qin et al.',
    sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
  },
  birefnetLite: {
    file: 'models/birefnet_lite_fp16.onnx',
    name: 'BiRefNet lite',
    about: 'Sharper edges; needs a strong GPU (uses IS-Net where it can\u2019t run)',
    mb: 115,
    license: 'MIT — Zheng Peng et al.',
    sha256: 'd39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402',
  },
  birefnet: {
    file: 'models/birefnet_fp16.onnx',
    name: 'BiRefNet',
    about: 'Cleanest edges (hair, fur); computers with a strong GPU (uses IS-Net where it can\u2019t run)',
    mb: 490,
    license: 'MIT — Zheng Peng et al.',
    sha256: '3654c741eb80bd926ada8fed1713b506ccf8d30eb1f6487e87eb9f234f33df09',
  },
} as const satisfies Record<string, { file: string; name: string; about: string; mb: number; license: string; sha256: string }>;
export type ModelId = keyof typeof MODELS;

const inMemory = new Map<string, Promise<ArrayBuffer>>();
onAiCleared(() => inMemory.clear());

export function loadModel(path: string): Promise<ArrayBuffer> {
  if (!aiEnabled()) return Promise.reject(new AiDisabledError());
  if (/^[a-z]+:/i.test(path) && new URL(path).origin !== location.origin) {
    return Promise.reject(new Error('AI models must be served from this app (on-device only)'));
  }
  if (!inMemory.has(path)) {
    inMemory.set(path, fetchCached(path).catch(e => { inMemory.delete(path); throw e; }));
  }
  return inMemory.get(path)!;
}

async function fetchCached(path: string): Promise<ArrayBuffer> {
  const cache = typeof caches !== 'undefined' ? await caches.open(AI_CACHE).catch(() => undefined) : undefined;
  const hit = await cache?.match(path);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(path);
  if (!res.ok) throw new Error(res.status === 404 ? 'this model isn’t on this server (run pnpm fetch-models)' : `model ${path}: ${res.status}`);
  await cache?.put(path, res.clone()).catch(() => { /* over quota: still works, just not cached */ });
  return res.arrayBuffer();
}

/** Is this model file on this server? (HEAD only; an SPA fallback page doesn't count.) */
export async function modelInstalled(file: string): Promise<boolean> {
  const r = await fetch(file, { method: 'HEAD' }).catch(() => null);
  return !!r?.ok && !/text\/html/.test(r.headers.get('content-type') ?? '');
}

/** What AI has downloaded to this device, with sizes. Works while AI is off, so space can always be freed. */
export async function storedAiData(): Promise<{ path: string; bytes: number }[]> {
  if (typeof caches === 'undefined' || !(await caches.has(AI_CACHE))) return [];
  const cache = await caches.open(AI_CACHE);
  const out: { path: string; bytes: number }[] = [];
  for (const req of await cache.keys()) {
    const r = await cache.match(req);
    const bytes = +(r?.headers.get('content-length') ?? 0) || (r ? (await r.blob()).size : 0);
    out.push({ path: new URL(req.url).pathname, bytes });
  }
  return out;
}

/** Delete one downloaded file (by path), or everything AI has downloaded. */
export async function removeAiData(path?: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  if (!path) {
    inMemory.clear();
    await caches.delete(AI_CACHE);
    return;
  }
  for (const k of inMemory.keys()) if (k.endsWith(path) || path.endsWith(k)) inMemory.delete(k);
  await (await caches.open(AI_CACHE)).delete(path);
}
