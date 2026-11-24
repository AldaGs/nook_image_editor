<!-- Selection actions, floating above the toolbar while something is selected. -->
<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { editor, ui } from '../lib/session.svelte';
  import { saveSticker } from '../lib/stickers';
  import { canvasRef } from '../lib/session.svelte';

  let { onDesign }: { onDesign: () => void } = $props();

  const selected = $derived.by(() => { ui.state.version; return editor.selectedNodes(); });
  const one = $derived(selected.length === 1 ? selected[0] : null);
  const hasPicture = $derived(!!one?.fills.some(f => f.kind === 'image'));
  const flattenable = $derived(selected.some(n => n.type === 'boolean' || n.type === 'group' || (['rect', 'ellipse', 'polygon', 'star', 'line'].includes(n.type) && !n.fills.some(f => f.kind === 'image'))));
  const pathLike = $derived(!!one && ['vector', 'polygon', 'star', 'line'].includes(one.type));
  const hasGroup = $derived(selected.some(n => n.type === 'group' || n.type === 'boolean'));
</script>

{#if ui.state.tool === 'pen'}
  <!-- While drawing a path: finish it open or closed, or take back the last point. -->
  <div class="bar" role="toolbar" aria-label="Pen">
    <span class="count">{ui.state.penPoints ? `${ui.state.penPoints} point${ui.state.penPoints === 1 ? '' : 's'}` : 'Tap to add points'}</span>
    <IconButton icon="undo" label="Undo point" disabled={!ui.state.penPoints} onclick={() => editor.undo()} />
    <button type="button" class="text" disabled={ui.state.penPoints < 3} onclick={() => { editor.finishPen(true); editor.setTool('select'); }}>Close</button>
    <button type="button" class="text" onclick={() => { editor.finishPen(); editor.setTool('select'); }}>Done</button>
  </div>
{:else if ui.state.pointEdit}
  {@const pe = ui.state.pointEdit}
  <!-- Editing points: act on the selected point, or finish. -->
  <div class="bar" role="toolbar" aria-label="Points">
    {#if pe.anchor === null}
      <span class="count">Tap a point or the path</span>
    {:else}
      <button type="button" class="text" onclick={() => editor.toggleSmooth()}>{pe.smooth || pe.split ? 'Corner' : 'Smooth'}</button>
      {#if pe.smooth || pe.split}
        <button type="button" class="text" aria-label={pe.split ? 'Join handles' : 'Break handles'} onclick={() => editor.toggleSplit()}>{pe.split ? 'Join' : 'Break'}</button>
      {/if}
      <IconButton icon="trash" label="Delete point" onclick={() => editor.deletePoint()} />
    {/if}
    <button type="button" class="text" onclick={() => editor.endPointEdit()}>Done</button>
  </div>
{:else if selected.length}
  <div class="bar" role="toolbar" aria-label="Selection">
    <span class="count">{one ? one.name : `${selected.length} selected`}</span>
    <IconButton icon="sliders" label="Design" onclick={onDesign} />
    {#if pathLike && one}
      <IconButton icon="spline" label="Edit points" onclick={() => editor.editPoints(one.id)} />
    {/if}
    <IconButton icon="arrowUp" label="Bring forward (])" disabled={!one} onclick={() => one && editor.reorder(one.id, 1)} />
    <IconButton icon="arrowDown" label="Send backward ([)" disabled={!one} onclick={() => one && editor.reorder(one.id, -1)} />
    <IconButton icon="group" label="Group (Ctrl+G)" onclick={() => editor.group()} />
    {#if selected.length > 1}
      <IconButton icon="combine" label="Combine shapes" onclick={() => editor.combine()} />
      <IconButton icon="mask" label="Mask (top layer masks the rest)" onclick={() => editor.mask()} />
    {/if}
    {#if flattenable}
      <IconButton icon="flatten" label="Flatten to path" onclick={() => canvasRef.engine?.flatten()} />
    {/if}
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
  .text { min-height: 40px; padding: 0 12px; background: none; border: none; border-radius: var(--radius); font-weight: 600; color: var(--accent, inherit); }
  .text:disabled { opacity: 0.4; }
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
