<!-- Sheet: a bottom sheet on phones (a centred dialog on wide screens). Tap outside to close.
     `peek` keeps it short and non-modal (no backdrop), so the canvas stays usable while it is open. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import IconButton from './IconButton.svelte';

  let { title, onClose, children, peek = false }: { title: string; onClose: () => void; children: Snippet; peek?: boolean } = $props();
</script>

{#if !peek}<div class="backdrop" role="presentation" onclick={onClose}></div>{/if}
<div class="sheet" class:peek role="dialog" aria-label={title}>
  <header>
    <h2>{title}</h2>
    <IconButton icon="x" label="Close" onclick={onClose} />
  </header>
  {@render children()}
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 0.3); z-index: 20; }
  .sheet.peek { max-height: 45vh; box-shadow: 0 -4px 16px rgb(0 0 0 / 0.15); }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 21;
    max-height: 70vh;
    overflow-x: hidden;
    overflow-y: auto;
    box-sizing: border-box;
    max-width: 100vw;
    padding: 0 var(--space) calc(var(--space) + env(safe-area-inset-bottom));
    background: var(--surface);
    border-radius: calc(var(--radius) * 1.6) calc(var(--radius) * 1.6) 0 0;
  }
  @media (min-width: 640px) {
    .sheet { left: 50%; bottom: auto; top: 20vh; width: 420px; transform: translateX(-50%); border-radius: calc(var(--radius) * 1.6); }
    /* Wide screens: a side panel that leaves the canvas visible. */
    .sheet.peek { left: auto; right: var(--space); top: calc(var(--bar-height) + var(--space)); width: 320px; max-height: calc(100vh - 2 * var(--bar-height) - 4 * var(--space)); transform: none; }
  }
  /* Stays put while the sheet's content scrolls under it. */
  header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; padding-left: var(--space); background: var(--surface); }
  h2 { font-size: 15px; margin: 0; }
</style>
