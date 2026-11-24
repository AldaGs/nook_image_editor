<!-- App layout for a phone screen: top bar, canvas (with the layers panel sliding
     over it), bottom toolbar. Sheets open on top. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Engine, FramePreset } from '@nook/engine';
  import { exportPbc } from '@nook/scene-export';
  import { requestPersistence } from '@nook/storage';
  import Canvas from './components/Canvas.svelte';
  import LayersPanel from './components/LayersPanel.svelte';
  import PresetSheet from './components/PresetSheet.svelte';
  import PropertiesSheet from './components/PropertiesSheet.svelte';
  import ExportSheet from './components/ExportSheet.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import TopBar from './components/TopBar.svelte';
  import { editor, loadSession, ui } from './lib/session.svelte';
  import { shareOrDownload } from './lib/files';
  import { attachShortcuts } from './lib/shortcuts';
  import { imageFiles, importImages } from './lib/assets';

  let engine = $state<Engine | null>(null);
  let layersOpen = $state(false);
  let presetsOpen = $state(false);
  let designOpen = $state(false);
  let exportOpen = $state(false);
  let notice = $state<string | null>(null);

  // Zoom to fit once both the saved document and the canvas are ready.
  let fitted = false;
  $effect(() => {
    if (engine && ui.loaded && !fitted) { fitted = true; engine.zoomToFit(); }
  });

  onMount(() => {
    loadSession();
    requestPersistence(); // ask the browser not to evict local files (matters on iOS)
    // Pasted pictures land in the middle of the view (text fields keep their own paste).
    const paste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
      const files = imageFiles(e.clipboardData?.files);
      if (!files.length) return;
      e.preventDefault();
      importImages(files);
    };
    window.addEventListener('paste', paste);
    const detach = attachShortcuts(editor, { fit });
    return () => { window.removeEventListener('paste', paste); detach(); };
  });

  function fit() {
    engine?.zoomToFit(editor.selection.length ? editor.selection : undefined);
  }

  function addBoard(p: FramePreset) {
    presetsOpen = false;
    const frame = editor.addFrame(p);
    engine?.zoomToFit([frame.id]);
  }

  async function exportToPbc() {
    editor.endTextEdit();
    const { text, report } = exportPbc(editor.doc, editor.pageId, { measure: engine ? (t, w) => engine!.measureLines(t, w) : undefined });
    await shareOrDownload('nook-board.pbc', text, 'application/json');
    notice = report.length ? `Exported with notes:\n• ${report.join('\n• ')}` : null;
  }
</script>

<main>
  <TopBar {layersOpen} onToggleLayers={() => (layersOpen = !layersOpen)} onFit={fit} onExport={() => { editor.endTextEdit(); exportOpen = true; }} />
  <div class="stage">
    <Canvas bind:engine onDesign={() => (designOpen = true)} />
    {#if layersOpen}<LayersPanel onClose={() => (layersOpen = false)} />{/if}
  </div>
  <Toolbar onAddBoard={() => (presetsOpen = true)} />
</main>

{#if presetsOpen}<PresetSheet onPick={addBoard} onClose={() => (presetsOpen = false)} />{/if}
{#if exportOpen}
  <ExportSheet {engine} onClose={() => (exportOpen = false)} onExportPbc={() => { exportOpen = false; exportToPbc(); }} />
{/if}
{#if designOpen}
  <PropertiesSheet onClose={() => (designOpen = false)} onEditGradient={(prop, index) => {
    designOpen = false;
    editor.editGradient({ nodeId: editor.selection[0]!, prop, index });
  }} />
{/if}

{#if notice || ui.error}
  <button type="button" class="toast" onclick={() => { notice = null; ui.error = null; }}>{ui.error ?? notice}</button>
{/if}

<style>
  main { display: flex; flex-direction: column; height: 100%; }
  .stage { position: relative; flex: 1; min-height: 0; display: flex; }
  .toast {
    position: fixed;
    left: var(--space);
    right: var(--space);
    top: calc(var(--bar-height) + env(safe-area-inset-top) + var(--space));
    z-index: 30;
    padding: var(--space) calc(var(--space) * 1.5);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
    text-align: left;
    white-space: pre-line;
    font-size: 13px;
  }
</style>
