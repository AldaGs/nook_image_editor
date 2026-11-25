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
    <!-- The Tucked mark from icon.svg, without its tile, in the text color. -->
    <svg class="logo" viewBox="112 100 296 296" aria-hidden="true">
      <path d="M148 136v168a72 72 0 0 0 72 72h156" fill="none" stroke="currentColor" stroke-width="40" stroke-linecap="round" />
      <path d="M290 160l58 58-58 58-58-58z" fill="currentColor" stroke="currentColor" stroke-width="28" stroke-linejoin="round" />
    </svg>
    <span class="title">Nook</span>
    <span class="saved" class:dirty={!ui.saved}>{ui.saved ? 'Saved' : 'Saving…'}</span>
    <IconButton icon="settings" label="Settings" onclick={onSettings} />
  </div>
  <div class="group">
    <IconButton icon="undo" label="Undo" disabled={!ui.state.canUndo} onclick={() => editor.undo()} />
    <IconButton icon="redo" label="Redo" disabled={!ui.state.canRedo} onclick={() => editor.redo()} />
    <IconButton icon="smartphone" label="Safe zones (stories, reels, IG grid crop)" active={ui.state.safeZones} onclick={() => editor.setSafeZones(!ui.state.safeZones)} />
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
  .group { display: flex; align-items: center; gap: 2px; flex: none; }
  .group:first-child { flex: 1 1 auto; min-width: 0; overflow: hidden; }
  .logo { width: 20px; height: 20px; flex: none; margin-left: 6px; }
  .title { font-weight: 600; margin: 0 var(--space) 0 6px; }
  .saved { color: var(--text-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .saved.dirty { color: var(--accent); }
  /* On narrow phones the title gives way to the buttons. */
  @media (max-width: 440px) { .title { display: none; } }
</style>
