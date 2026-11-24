<!-- Selection actions, floating above the toolbar while something is selected. -->
<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { editor, ui } from '../lib/session.svelte';
  import { saveSticker } from '../lib/stickers';

  let { onDesign }: { onDesign: () => void } = $props();

  const selected = $derived.by(() => { ui.state.version; return editor.selectedNodes(); });
  const one = $derived(selected.length === 1 ? selected[0] : null);
  const hasPicture = $derived(!!one?.fills.some(f => f.kind === 'image'));
  const hasGroup = $derived(selected.some(n => n.type === 'group'));
</script>

{#if selected.length}
  <div class="bar" role="toolbar" aria-label="Selection">
    <span class="count">{one ? one.name : `${selected.length} selected`}</span>
    <IconButton icon="sliders" label="Design" onclick={onDesign} />
    <IconButton icon="arrowUp" label="Bring forward (])" disabled={!one} onclick={() => one && editor.reorder(one.id, 1)} />
    <IconButton icon="arrowDown" label="Send backward ([)" disabled={!one} onclick={() => one && editor.reorder(one.id, -1)} />
    <IconButton icon="group" label="Group (Ctrl+G)" onclick={() => editor.group()} />
    <IconButton icon="ungroup" label="Ungroup (Ctrl+Shift+G)" disabled={!hasGroup} onclick={() => editor.ungroup()} />
    {#if hasPicture}
      <IconButton icon="bookmarkPlus" label="Save to stickers" onclick={async () => { if (one && await saveSticker(one)) ui.error = `Saved "${one.name}" to your stickers.`; }} />
    {/if}
    <IconButton icon="trash" label="Delete" onclick={() => editor.deleteSelection()} />
  </div>
{/if}

<style>
  .bar {
    position: absolute;
    left: 50%;
    bottom: var(--space);
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 2px;
    max-width: calc(100% - 2 * var(--space));
    padding: 2px 2px 2px calc(var(--space) * 1.5);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) + 4px);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.12);
  }
  .count {
    max-width: 30vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: 12px;
    margin-right: 4px;
  }
</style>
