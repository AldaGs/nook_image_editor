// The Google Fonts catalog, by way of the Fontsource API (no key needed).
// The list and every font file are kept in the Cache API, so fonts already used
// keep working offline. Families picked once are remembered with their weights,
// so a board still knows them before the catalog has loaded.

const API = 'https://api.fontsource.org/v1/fonts';
const CACHE = 'nook-fonts-v1';
const REMEMBERED = 'nook.fonts.remembered';

export interface CatalogFont {
  id: string;
  family: string;
  category: string;
  weights: number[];
  defSubset: string;
  subsets: string[];
}

const read = (): Record<string, number[]> => {
  try { return JSON.parse(localStorage.getItem(REMEMBERED) ?? '{}'); } catch { return {}; }
};

export const catalog = $state({
  fonts: [] as CatalogFont[],
  byFamily: new Map<string, CatalogFont>(),
  status: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
  remembered: read(),
});

export const slug = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const fontFileUrl = (id: string, subset: string, weight: number) =>
  `https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/${subset}-${weight}-normal.woff2`;

/** Network first, falling back to (and filling) the cache. */
export async function cachedFetch(url: string): Promise<Response | null> {
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null;
  try {
    const res = await fetch(url);
    if (res.ok) { await cache?.put(url, res.clone()).catch(() => {}); return res; }
  } catch { /* offline: try the cache */ }
  return (await cache?.match(url)) ?? null;
}

/** Load the catalog once (from the cache when offline). */
export async function loadCatalog(): Promise<void> {
  if (catalog.status === 'loading' || catalog.status === 'ready') return;
  catalog.status = 'loading';
  try {
    const res = await cachedFetch(API);
    if (!res) throw new Error('offline');
    const list = (await res.json()) as CatalogFont[];
    // Upright Latin fonts only: text layers draw the normal style.
    const fonts = list
      .filter(f => f.subsets?.includes('latin') && f.weights?.length)
      .map(f => ({ ...f, defSubset: f.subsets.includes('latin') ? 'latin' : f.defSubset }))
      .sort((a, b) => a.family.localeCompare(b.family));
    catalog.fonts = fonts;
    catalog.byFamily = new Map(fonts.map(f => [f.family, f]));
    catalog.status = 'ready';
  } catch {
    catalog.status = 'error';
  }
}

/** Keep a picked family's weights so it works before the catalog loads next time. */
export function remember(font: CatalogFont): void {
  catalog.remembered = { ...catalog.remembered, [font.family]: font.weights };
  try { localStorage.setItem(REMEMBERED, JSON.stringify(catalog.remembered)); } catch { /* private mode */ }
}
