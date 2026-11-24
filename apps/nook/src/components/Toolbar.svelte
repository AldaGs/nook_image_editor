<!-- Bottom toolbar: tools, add a board from a preset, and multi-select mode (touch has no Shift). -->
<script lang="ts">
  import type { ToolId } from '@nook/engine';
  import IconButton from './IconButton.svelte';
  import type { IconName } from './Icon.svelte';
  import { editor, ui } from '../lib/session.svelte';

  let { onAddBoard }: { onAddBoard: () => void } = $props();

  const TOOLS: { id: ToolId; icon: IconName; label: string }[] = [
    { id: 'select', icon: 'pointer', label: 'Select (V)' },
    { id: 'frame', icon: 'frame', label: 'Frame (F)' },
    { id: 'rect', icon: 'square', label: 'Rectangle (R)' },
    { id: 'ellipse', icon: 'circle', label: 'Ellipse (O)' },
  ];
</script>

<nav>
  {#each TOOLS as t (t.id)}
    <IconButton icon={t.icon} label={t.label} active={ui.state.tool === t.id} onclick={() => editor.setTool(t.id)} />
  {/each}
  <span class="sep"></span>
  <IconButton icon="layoutTemplate" label="Add board" onclick={onAddBoard} />
  <IconButton icon="listChecks" label="Multi-select" active={ui.state.multiSelect} onclick={() => editor.setMultiSelect(!ui.state.multiSelect)} />
</nav>

<style>
  nav {
    display: flex;
    justify-content: center;
    gap: 4px;
    padding: 6px calc(var(--space) + env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom)) calc(var(--space) + env(safe-area-inset-left));
    background: var(--surface);
    border-top: 1px solid var(--border);
  }
  .sep { width: 1px; margin: 8px 4px; background: var(--border); }
</style>
