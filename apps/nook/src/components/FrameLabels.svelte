<!-- Frame names above each board. Tapping a label selects that board
     (a one-finger drag on a board pans, so this is how you grab a board on touch). -->
<script lang="ts">
  import type { FrameLabel } from '@nook/engine';
  import { editor } from '../lib/session.svelte';

  let { labels }: { labels: FrameLabel[] } = $props();
</script>

{#each labels as l (l.id)}
  <button
    type="button"
    class:selected={l.selected}
    style:transform="translate({l.screen.x}px, {l.screen.y - 22}px)"
    onclick={() => editor.select([l.id])}
  >{l.name}</button>
{/each}

<style>
  button {
    position: absolute;
    top: 0;
    left: 0;
    max-width: 200px;
    padding: 2px 0;
    overflow: hidden;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button.selected { color: var(--accent); font-weight: 600; }
</style>
