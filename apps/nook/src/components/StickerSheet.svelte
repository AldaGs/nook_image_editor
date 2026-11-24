<!-- Sticker library: the starter pack and your saved stickers. Tap one to add it. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import Sheet from './Sheet.svelte';
  import IconButton from './IconButton.svelte';
  import { loadAsset } from '../lib/assets';
  import { STARTERS, addSaved, addStarter, loadSaved, removeSaved, svgUrl, type SavedSticker } from '../lib/stickers';

  let { onClose }: { onClose: () => void } = $props();

  let saved = $state<{ s: SavedSticker; url: string }[]>([]);
  async function refresh() {
    saved.forEach(x => URL.revokeObjectURL(x.url));
    const list = await loadSaved();
    saved = await Promise.all(list.map(async s => {
      const b = await loadAsset(s.fill.assetId);
      return { s, url: b ? URL.createObjectURL(new Blob([b])) : '' };
    }));
  }
  onMount(() => { refresh(); return () => saved.forEach(x => URL.revokeObjectURL(x.url)); });
</script>

<Sheet title="Stickers" {onClose}>
  {#if saved.length}
    <h3>Saved</h3>
    <ul>
      {#each saved as x, i (i)}
        <li class="saved">
          <button type="button" aria-label="Add {x.s.name}" onclick={() => { addSaved(x.s); onClose(); }}><img src={x.url} alt="" /></button>
          <span class="remove"><IconButton icon="x" label="Remove {x.s.name} from saved" onclick={async () => { await removeSaved(i); refresh(); }} /></span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="hint">To save your own, select a picture layer and tap Save to stickers (the bookmark).</p>
  {/if}
  <h3>Starter pack</h3>
  <ul>
    {#each STARTERS as s (s.name)}
      <li><button type="button" aria-label="Add {s.name}" onclick={() => { addStarter(s); onClose(); }}><img src={svgUrl(s.svg)} alt="" /></button></li>
    {/each}
  </ul>
</Sheet>

<style>
  h3 { margin: 8px var(--space) 4px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .hint { margin: 4px var(--space); font-size: 12px; color: var(--text-muted); }
  ul { list-style: none; margin: 0; padding: 0 var(--space) var(--space); display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 8px; }
  li { position: relative; }
  button { width: 100%; aspect-ratio: 1; padding: 8px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); }
  button:active { background: var(--border); }
  img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .remove { position: absolute; top: -12px; right: -12px; font-size: 12px; }
  ul:has(.saved) { padding-top: 12px; }
  .remove :global(button) { width: auto; aspect-ratio: auto; padding: 2px; border-radius: 50%; background: var(--surface); }
</style>
