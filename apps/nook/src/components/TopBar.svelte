<!-- Top bar: undo/redo, save state, zoom to fit, export and the layers toggle. -->
<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { editor, ui } from '../lib/session.svelte';

  let { layersOpen, onToggleLayers, onFit, onExport, onSettings }: {
    layersOpen: boolean;
    onToggleLayers: () => void;
    onFit: () => void;
    onExport: () => void;
    onSettings: () => void;
  } = $props();
</script>

<header>
  <div class="group">
    <IconButton icon="layers" label="Layers" active={layersOpen} onclick={onToggleLayers} />
    <span class="title">Nook</span>
    <span class="saved" class:dirty={!ui.saved}>{ui.saved ? 'Saved' : 'Saving…'}</span>
    <IconButton icon="settings" label="Settings" onclick={onSettings} />
  </div>
  <div class="group">
    <IconButton icon="undo" label="Undo" disabled={!ui.state.canUndo} onclick={() => editor.undo()} />
    <IconButton icon="redo" label="Redo" disabled={!ui.state.canRedo} onclick={() => editor.redo()} />
    <IconButton icon="smartphone" label="Safe zones (stories, reels)" active={ui.state.safeZones} onclick={() => editor.setSafeZones(!ui.state.safeZones)} />
    <IconButton icon="maximize" label="Zoom to fit" onclick={onFit} />
    <IconButton icon="share" label="Export" onclick={onExport} />
  </div>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: var(--bar-height);
    padding: env(safe-area-inset-top) calc(var(--space) + env(safe-area-inset-right)) 0 calc(var(--space) + env(safe-area-inset-left));
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .group { display: flex; align-items: center; gap: 2px; }
  .title { font-weight: 600; margin: 0 var(--space); }
  .saved { color: var(--text-muted); font-size: 12px; }
  .saved.dirty { color: var(--accent); }
  /* On narrow phones the title gives way to the buttons. */
  @media (max-width: 380px) { .title { display: none; } }
</style>
