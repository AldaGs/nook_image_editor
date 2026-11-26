<!-- Font picker: the bundled fonts first, then a search over the Google Fonts catalog
     (Fontsource). Each listed family is previewed in its own face. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { FONTS } from '../lib/fonts';
  import { catalog, fontFileUrl, loadCatalog, remember, type CatalogFont } from '../lib/fontCatalog.svelte';

  let { value, onPick }: { value: string; onPick: (family: string) => void } = $props();

  let open = $state(false);
  let query = $state('');
  let category = $state('all');
  const SHOWN = 40;

  onMount(() => { loadCatalog(); });

  const bundled = Object.keys(FONTS);
  const categories = $derived(['all', ...new Set(catalog.fonts.map(f => f.category))]);
  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return catalog.fonts.filter(f => !FONTS[f.family] && (category === 'all' || f.category === category) && (!q || f.family.toLowerCase().includes(q)));
  });
  const recent = $derived(Object.keys(catalog.remembered).filter(f => !FONTS[f]));

  // Preview faces for the families on screen, each loaded once under a private name.
  const previewed = new Set<string>();
  function preview(f: CatalogFont) {
    if (previewed.has(f.id) || typeof FontFace === 'undefined') return;
    previewed.add(f.id);
    const w = f.weights.includes(400) ? 400 : f.weights[0]!;
    new FontFace(`nook-preview-${f.id}`, `url(${fontFileUrl(f.id, f.defSubset, w)})`, { weight: String(w) })
      .load().then(face => document.fonts.add(face)).catch(() => {});
  }
  $effect(() => { if (open) matches.slice(0, SHOWN).forEach(preview); });

  function pick(family: string) {
    const f = catalog.byFamily.get(family);
    if (f) remember(f);
    onPick(family);
    open = false;
    query = '';
  }
  const face = (family: string) => {
    const f = catalog.byFamily.get(family);
    return FONTS[family] || !f ? 'inherit' : `'nook-preview-${f.id}', inherit`;
  };
</script>

<button type="button" class="current" aria-expanded={open} onclick={() => (open = !open)}>
  <span>{value}</span><span class="muted">{open ? '▴' : '▾'}</span>
</button>

{#if open}
  <div class="picker">
    <div class="search">
      <input type="search" placeholder="Search Google Fonts" aria-label="Search fonts" bind:value={query} />
      {#if catalog.status === 'ready'}
        <select aria-label="Category" bind:value={category}>
          {#each categories as c (c)}<option value={c}>{c === 'all' ? 'All' : c[0]!.toUpperCase() + c.slice(1)}</option>{/each}
        </select>
      {/if}
    </div>
    <ul>
      {#if !query && category === 'all'}
        {#each bundled as f (f)}
          <li><button type="button" class:on={f === value} onclick={() => pick(f)}>{f}<span class="muted">offline</span></button></li>
        {/each}
        {#each recent as f (f)}
          <li><button type="button" class:on={f === value} style:font-family={face(f)} onclick={() => pick(f)}>{f}<span class="muted">recent</span></button></li>
        {/each}
      {/if}
      {#if catalog.status === 'loading'}<li class="note">Loading Google Fonts…</li>{/if}
      {#if catalog.status === 'error'}<li class="note">Couldn't reach Google Fonts. Bundled fonts still work offline.</li>{/if}
      {#each matches.slice(0, SHOWN) as f (f.id)}
        <li><button type="button" class:on={f.family === value} style:font-family={face(f.family)} onclick={() => pick(f.family)}>
          {f.family}<span class="muted">{f.weights.length} weight{f.weights.length > 1 ? 's' : ''}</span>
        </button></li>
      {/each}
      {#if matches.length > SHOWN}<li class="note">{matches.length - SHOWN} more. Keep typing to narrow it down.</li>{/if}
      {#if catalog.status === 'ready' && !matches.length}<li class="note">No fonts match.</li>{/if}
    </ul>
  </div>
{/if}

<style>
  .current {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    width: 100%; min-height: var(--touch-target); padding: 0 12px;
    border: 1px solid var(--border); border-radius: 10px; background: none; font-size: 15px; text-align: left;
  }
  .picker { margin-top: 6px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .search { display: flex; gap: 6px; padding: 6px; border-bottom: 1px solid var(--border); }
  .search input { flex: 1; min-width: 0; min-height: 36px; padding: 0 10px; font-size: 16px; }
  .search select { min-height: 36px; }
  ul { list-style: none; margin: 0; padding: 0; max-height: 280px; overflow-y: auto; }
  li button {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    width: 100%; min-height: 44px; padding: 0 12px; border: none; background: none; font-size: 18px; text-align: left;
  }
  li button.on { background: var(--bg); font-weight: 600; }
  .muted { color: var(--text-muted); font-size: 12px; font-family: system-ui, sans-serif; font-weight: 400; }
  .note { padding: 10px 12px; color: var(--text-muted); font-size: 13px; }
</style>
