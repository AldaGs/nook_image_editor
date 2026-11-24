// Model loading, ported from Heirloom. `loadModel` is the only way to get a model:
// it refuses while AI is off and only fetches from this app's own origin.

import { aiEnabled, AiDisabledError, onAiCleared } from './switch.ts';

/** AI files get their own Cache Storage bucket so "Remove AI data" drops exactly them. */
export const AI_CACHE = 'nook-ai';

/** Same-origin model files. BiRefNet is added in stage 3 (background removal). */
export const MODELS = {} as const satisfies Record<string, { file: string; name: string; license: string; sha256: string }>;

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
  if (!res.ok) throw new Error(`model ${path}: ${res.status}`);
  await cache?.put(path, res.clone()).catch(() => { /* over quota: still works, just not cached */ });
  return res.arrayBuffer();
}

/** Delete everything AI has downloaded. Works while AI is off, so space can always be freed. */
export async function removeAiData(): Promise<void> {
  inMemory.clear();
  if (typeof caches !== 'undefined') await caches.delete(AI_CACHE);
}
