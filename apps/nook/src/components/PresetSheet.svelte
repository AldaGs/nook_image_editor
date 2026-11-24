<!-- Board presets (README "Frame presets"): pick one to add a new board. -->
<script lang="ts">
  import { FRAME_PRESETS, type FramePreset } from '@nook/engine';
  import Sheet from './Sheet.svelte';

  let { onPick, onClose }: { onPick: (p: FramePreset) => void; onClose: () => void } = $props();
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
</style>
