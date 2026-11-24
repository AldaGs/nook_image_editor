<!-- Board presets (README "Frame presets"): pick one to add a new board. -->
<script lang="ts">
  import { FRAME_PRESETS } from '@nook/engine';
  type BoardSize = { name: string; width: number; height: number };
  import Sheet from './Sheet.svelte';

  let { onPick, onClose }: { onPick: (p: BoardSize) => void; onClose: () => void } = $props();

  // Custom size, in px (clamped to what export can handle sensibly).
  let w = $state(1080);
  let h = $state(1080);
  const clamp = (v: number) => Math.round(Math.min(8192, Math.max(1, Number.isFinite(v) ? v : 1)));

</script>

<Sheet title="Add board" {onClose}>
  <ul>
    {#each FRAME_PRESETS as p (p.id)}
      <li>
        <button type="button" onclick={() => onPick(p)}>
          <!-- A tiny proportional preview of the board shape. -->
          <span class="shape" style:aspect-ratio="{p.width} / {p.height}"></span>
          <span class="name">{p.name}</span>
          <span class="size">{p.width}×{p.height}</span>
        </button>
      </li>
    {/each}
    <li class="custom">
      <span class="shape" style:aspect-ratio="{clamp(w)} / {clamp(h)}"></span>
      <span class="name">Custom</span>
      <label>W<input type="number" inputmode="numeric" min="1" max="8192" bind:value={w} /></label>
      <label>H<input type="number" inputmode="numeric" min="1" max="8192" bind:value={h} /></label>
      <button type="button" class="add" onclick={() => onPick({ name: 'Board', width: clamp(w), height: clamp(h) })}>Add</button>
    </li>
  </ul>
</Sheet>

<style>
  ul { list-style: none; margin: 0; padding: 0; }
  button {
    display: flex;
    align-items: center;
    gap: calc(var(--space) * 1.5);
    width: 100%;
    min-height: 52px;
    padding: 0 var(--space);
    background: none;
    border: none;
    border-radius: var(--radius);
    text-align: left;
  }
  button:active { background: var(--border); }
  .shape { width: 24px; max-height: 28px; border: 1.5px solid var(--text-muted); border-radius: 3px; }
  .name { flex: 1; }
  .size { color: var(--text-muted); font-variant-numeric: tabular-nums; font-size: 12px; }
  .custom { display: flex; align-items: center; gap: 8px; min-height: 52px; padding: 0 var(--space); flex-wrap: wrap; }
  .custom label { display: flex; align-items: center; gap: 4px; color: var(--text-muted); font-size: 12px; }
  .custom input { width: 4.6em; }
  .custom .add { width: auto; min-height: 36px; flex: none; padding: 0 14px; border: 1px solid var(--border); font-weight: 600; justify-content: center; }
</style>
