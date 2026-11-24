// Global AI switch, ported from Heirloom. AI is off by default and per device;
// turning it off drops loaded models so nothing lingers in memory.

const KEY = 'nook:ai';
const listeners = new Set<(on: boolean) => void>();
const clearHooks = new Set<() => void>();

export function aiEnabled(): boolean {
  try { return localStorage.getItem(KEY) === 'true'; } catch { return false; }
}

export function setAiEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, String(on)); } catch { /* stays off on reload */ }
  if (!on) clearHooks.forEach(f => f());
  listeners.forEach(f => f(on));
}

/** Subscribe to switch changes. Returns an unsubscribe function. */
export function onAiChange(f: (on: boolean) => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/** Internal: the model cache registers here to empty itself when AI turns off. */
export function onAiCleared(f: () => void): void {
  clearHooks.add(f);
}

export class AiDisabledError extends Error {
  constructor() {
    super('AI features are turned off (Settings → AI)');
    this.name = 'AiDisabledError';
  }
}
