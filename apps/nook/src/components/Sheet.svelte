<!-- Sheet: a bottom sheet on phones (a centred dialog on wide screens). Tap outside to close. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import IconButton from './IconButton.svelte';

  let { title, onClose, children }: { title: string; onClose: () => void; children: Snippet } = $props();
</script>

<div class="backdrop" role="presentation" onclick={onClose}></div>
<div class="sheet" role="dialog" aria-label={title}>
  <header>
    <h2>{title}</h2>
    <IconButton icon="x" label="Close" onclick={onClose} />
  </header>
  {@render children()}
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 0.3); z-index: 20; }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 21;
    max-height: 70vh;
    overflow: auto;
    padding: 0 var(--space) calc(var(--space) + env(safe-area-inset-bottom));
    background: var(--surface);
    border-radius: calc(var(--radius) * 1.6) calc(var(--radius) * 1.6) 0 0;
  }
  @media (min-width: 640px) {
    .sheet { left: 50%; bottom: auto; top: 20vh; width: 420px; transform: translateX(-50%); border-radius: calc(var(--radius) * 1.6); }
  }
  header { display: flex; align-items: center; justify-content: space-between; padding-left: var(--space); }
  h2 { font-size: 15px; margin: 0; }
</style>
