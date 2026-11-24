<!-- Bottom toolbar: tools, add a board from a preset, and multi-select mode (touch has no Shift). -->
<script lang="ts">
  import type { ToolId } from '@nook/engine';
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './Icon.svelte';
  import { editor, ui } from '../lib/session.svelte';
  import { imageFiles, importImages } from '../lib/assets';

  let picker: HTMLInputElement;

  let { onAddBoard, onStickers }: { onAddBoard: () => void; onStickers: () => void } = $props();

  type ToolDef = { id: ToolId; icon: IconName; label: string };
  const BEFORE: ToolDef[] = [
    { id: 'select', icon: 'pointer', label: 'Select (V)' },
    { id: 'frame', icon: 'frame', label: 'Frame (F)' },
  ];
  /** Grouped behind one button that opens upward. */
  const SHAPES: ToolDef[] = [
    { id: 'rect', icon: 'square', label: 'Rectangle (R)' },
    { id: 'ellipse', icon: 'circle', label: 'Ellipse (O)' },
    { id: 'polygon', icon: 'pentagon', label: 'Polygon' },
    { id: 'star', icon: 'star', label: 'Star' },
    { id: 'line', icon: 'slash', label: 'Line (L)' },
  ];
  const AFTER: ToolDef[] = [
    { id: 'pen', icon: 'penTool', label: 'Pen (P)' },
    { id: 'text', icon: 'type', label: 'Text (T)' },
  ];

  // The shape button shows the shape in use, or the last one picked (shortcuts count too).
  let lastShape = $state<ToolDef>(SHAPES[0]!);
  $effect(() => { const s = SHAPES.find(t => t.id === ui.state.tool); if (s) lastShape = s; });
  const shapeActive = $derived(SHAPES.some(t => t.id === ui.state.tool));

  let menuOpen = $state(false);
  let menuLeft = $state(0);
  let wrap: HTMLDivElement;
  let shapeSlot: HTMLSpanElement;

  function toggleMenu() {
    if (menuOpen) { menuOpen = false; return; }
    const b = shapeSlot.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    // Centred on the button, but kept on screen (the menu is about 176 px wide).
    menuLeft = Math.min(Math.max(b.left - w.left + b.width / 2, 96), w.width - 96);
    menuOpen = true;
  }
  function pick(t: ToolDef) {
    editor.setTool(t.id);
    menuOpen = false;
  }
  // A press anywhere outside the menu and its button closes it.
  $effect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => { if (!wrap.contains(e.target as Node)) menuOpen = false; };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  });
</script>

<div class="wrap" bind:this={wrap}>
{#if menuOpen}
  <div class="menu" role="menu" aria-label="Shapes" style:left="{menuLeft}px">
    {#each SHAPES as t (t.id)}
      <button type="button" role="menuitemradio" aria-checked={ui.state.tool === t.id} class:on={ui.state.tool === t.id} onclick={() => pick(t)}>
        <Icon name={t.icon} /><span>{t.label.replace(/ \(.\)$/, '')}</span>
      </button>
    {/each}
  </div>
{/if}
<nav onscroll={() => (menuOpen = false)}>
  {#each BEFORE as t (t.id)}
    <IconButton icon={t.icon} label={t.label} active={ui.state.tool === t.id} onclick={() => editor.setTool(t.id)} />
  {/each}
  <span class="shapes" bind:this={shapeSlot}>
    <IconButton icon={lastShape.icon} label="Shapes ({lastShape.label})" active={shapeActive || menuOpen} onclick={toggleMenu} />
    <span class="caret" aria-hidden="true"></span>
  </span>
  {#each AFTER as t (t.id)}
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
</div>

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
  .wrap { position: relative; }
  .shapes { position: relative; display: inline-flex; }
  /* A small corner mark: this button opens more. */
  .caret { position: absolute; right: 6px; bottom: 6px; width: 0; height: 0; border-left: 4px solid transparent; border-bottom: 4px solid currentColor; opacity: 0.5; pointer-events: none; }
  .menu {
    position: absolute;
    bottom: calc(100% + 6px);
    transform: translateX(-50%);
    z-index: 20;
    display: flex;
    flex-direction: column;
    min-width: 168px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) + 4px);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
    animation: rise 120ms ease-out;
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: var(--touch-target);
    padding: 0 12px;
    background: none;
    border: none;
    border-radius: var(--radius);
    font: inherit;
    font-size: 15px;
    color: inherit;
    text-align: left;
  }
  .menu button :global(.icon) { font-size: 18px; }
  .menu button.on { background: var(--border); font-weight: 600; }
  .menu button:active { background: var(--border); }
  @keyframes rise { from { opacity: 0; transform: translate(-50%, 6px); } }
  @media (prefers-reduced-motion: reduce) { .menu { animation: none; } }
  .sep { flex: none; width: 1px; margin: 8px 2px; background: var(--border); }
</style>
