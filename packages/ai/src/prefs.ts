// Which background-removal model this device uses (Settings). Lite by default:
// it suits phones; the full model is a 490 MB download best kept for computers.
import type { ModelId } from './models.ts';

const KEY = 'nook:bg-model';

export function backgroundModel(): ModelId {
  try { return localStorage.getItem(KEY) === 'birefnet' ? 'birefnet' : 'birefnetLite'; } catch { return 'birefnetLite'; }
}

export function setBackgroundModel(id: ModelId): void {
  try { localStorage.setItem(KEY, id); } catch { /* falls back to lite on reload */ }
}
