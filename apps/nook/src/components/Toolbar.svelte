<!-- Bottom toolbar: tools, add a board from a preset, and multi-select mode (touch has no Shift). -->
<script lang="ts">
  import type { ToolId } from '@nook/engine';
  import IconButton from './IconButton.svelte';
  import type { IconName } from './Icon.svelte';
  import { editor, ui } from '../lib/session.svelte';
  import { imageFiles, importImages } from '../lib/assets';

  let picker: HTMLInputElement;

  let { onAddBoard, onStickers }: { onAddBoard: () => void; onStickers: () => void } = $props();

  const TOOLS: { id: ToolId; icon: IconName; label: string }[] = [
    { id: 'select', icon: 'pointer', label: 'Select (V)' },
    { id: 'frame', icon: 'frame', label: 'Frame (F)' },
    { id: 'rect', icon: 'square', label: 'Rectangle (R)' },
    { id: 'ellipse', icon: 'circle', label: 'Ellipse (O)' },
    { id: 'polygon', icon: 'pentagon', label: 'Polygon' },
    { id: 'star', icon: 'star', label: 'Star' },
    { id: 'line', icon: 'slash', label: 'Line (L)' },
    { id: 'pen', icon: 'penTool', label: 'Pen (P)' },
    { id: 'text', icon: 'type', label: 'Text (T)' },
  ];
</script>

<nav>
  {#each TOOLS as t (t.id)}
    <IconButton icon={t.icon} label={t.label} active={ui.state.tool === t.id} onclick={() => editor.setTool(t.id)} />
  {/each}
  <IconButton icon="image" label="Add picture" onclick={() => picker.click()} />
  <IconButton icon="sticker" label="Stickers" onclick={onStickers} />
  <!-- The photo picker on phones; a file dialog elsewhere. -->
  <input bind:this={picker} type="file" accept="image/*" multiple hidden
    onchange={e => { importImages(imageFiles(e.currentTarget.files)); e.currentTarget.value = ''; }} />
  <span class="sep"></span>
  <IconButton icon="layoutTemplate" label="Add board" onclick={onAddBoard} />
  <IconButton icon="listChecks" label="Multi-select" active={ui.state.multiSelect} onclick={() => editor.setMultiSelect(!ui.state.multiSelect)} />
</nav>

<style>
  nav {
    display: flex;
    /* Centred when it fits; on narrow phones it scrolls instead of clipping the ends. */
    justify-content: safe center;
    overflow-x: auto;
    scrollbar-width: none;
    gap: 2px;
    padding: 6px calc(var(--space) + env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom)) calc(var(--space) + env(safe-area-inset-left));
    background: var(--surface);
    border-top: 1px solid var(--border);
  }
  .sep { flex: none; width: 1px; margin: 8px 2px; background: var(--border); }
</style>
