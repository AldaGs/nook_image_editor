// Which background-removal model this device uses (Settings). IS-Net by
// default: it runs on any device; BiRefNet is for computers with a strong GPU.
import { MODELS, type ModelId } from './models.ts';

const KEY = 'nook:bg-model';

export function backgroundModel(): ModelId {
  try {
    const v = localStorage.getItem(KEY);
    return v && v in MODELS ? (v as ModelId) : 'isnet';
  } catch {
    return 'isnet';
  }
}

export function setBackgroundModel(id: ModelId): void {
  try { localStorage.setItem(KEY, id); } catch { /* falls back to IS-Net on reload */ }
}
