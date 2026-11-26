<!-- App layout for a phone screen: top bar, canvas (with the layers panel sliding
     over it), bottom toolbar. Sheets open on top. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { usedAssets, type Engine } from '@nook/engine';
  import { exportPbc } from '@nook/scene-export';
  import { requestPersistence } from '@nook/storage';
  import Canvas from './components/Canvas.svelte';
  import LayersPanel from './components/LayersPanel.svelte';
  import PresetSheet from './components/PresetSheet.svelte';
  import PropertiesSheet from './components/PropertiesSheet.svelte';
  import ExportSheet from './components/ExportSheet.svelte';
  import StickerSheet from './components/StickerSheet.svelte';
  import SettingsSheet from './components/SettingsSheet.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import TopBar from './components/TopBar.svelte';
  import Home from './components/Home.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import { editor, loadSession, ui } from './lib/session.svelte';
  import { shareFiles, shareOrDownload } from './lib/files';
  import { zip } from './lib/zip';
  import { attachShortcuts } from './lib/shortcuts';
  import { imageFiles, importImages, loadAsset } from './lib/assets';
  import { svgText } from './lib/svg';

  let engine = $state<Engine | null>(null);
  let layersOpen = $state(false);
  let presetsOpen = $state(false);
  let designOpen = $state(false);
  let exportOpen = $state(false);
  let settingsOpen = $state(false);
  let stickersOpen = $state(false);
  let notice = $state<string | null>(null);

  // Zoom to fit once both the saved document and the canvas are ready.
  let fitted = false;
  $effect(() => {
    if (engine && ui.loaded && !fitted) { fitted = true; engine.zoomToFit(); }
  });
  $effect(() => { if (!ui.projectId) fitted = false; }); // refit when the next project opens

  onMount(() => {
    loadSession();
    requestPersistence(); // ask the browser not to evict local files (matters on iOS)
    // Pasted pictures and SVG land in the middle of the view (text fields keep their own paste).
    const paste = (e: ClipboardEvent) => {
      if (!ui.projectId) return; // nothing to paste into on the home screen
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
      const files = imageFiles(e.clipboardData?.files);
      const svg = files.length ? '' : svgText(e.clipboardData);
      if (svg) files.push(new File([svg], 'SVG.svg', { type: 'image/svg+xml' }));
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

  function addBoard(p: { name: string; width: number; height: number }) {
    presetsOpen = false;
    const frame = editor.addFrame(p);
    engine?.zoomToFit([frame.id]);
  }

  /**
   * The boards as a PBC scene. With pictures, a .zip holding "Nook board/Nook board.pbc"
   * and the pictures in "Nook board/assets/" (PBC finds them beside the .pbc); without, the bare .pbc.
   */
  async function exportToPbc() {
    editor.endTextEdit();
    try {
      const bytes = new Map<string, Uint8Array>();
      for (const id of usedAssets(editor.doc)) {
        const b = await loadAsset(id);
        if (b) bytes.set(id, new Uint8Array(b));
      }
      const ext = (id: string) => (bytes.get(id)?.[0] === 0xff ? 'jpg' : 'png'); // JPEG starts FF D8
      const { text, report, assets } = exportPbc(editor.doc, editor.pageId, { measure: engine ? (t, w) => engine!.measureLines(t, w) : undefined, assetExt: ext });
      const name = 'Nook board';
      if (!assets.length) {
        await shareOrDownload(`${name}.pbc`, text, 'application/json');
      } else {
        const files: { path: string; data: Uint8Array }[] = [{ path: `${name}/${name}.pbc`, data: new TextEncoder().encode(text) }];
        for (const a of assets) {
          const data = bytes.get(a.assetId);
          if (data) files.push({ path: `${name}/${a.path}`, data });
          else report.push(`A picture couldn't be read from this device, so "${a.path}" is missing from the export.`);
        }
        await shareFiles([new File([zip(files)], `${name}.zip`, { type: 'application/zip' })]);
        report.unshift(`Unzip "${name}.zip" and open "${name}.pbc"; its pictures are in the assets folder next to it.`);
      }
      notice = report.length ? `Exported with notes:\n• ${report.join('\n• ')}` : null;
    } catch (e) {
      ui.error = `Couldn't export the PBC scene: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
</script>

{#if !ui.projectId}
  <Home />
{:else}
<main>
  <TopBar {layersOpen} onToggleLayers={() => (layersOpen = !layersOpen)} onFit={fit} onExport={() => { editor.endTextEdit(); exportOpen = true; }} onSettings={() => (settingsOpen = true)} />
  <div class="stage">
    <Canvas bind:engine onDesign={() => (designOpen = true)} />
    {#if layersOpen}<LayersPanel onClose={() => (layersOpen = false)} />{/if}
  </div>
  <Toolbar onAddBoard={() => (presetsOpen = true)} onStickers={() => (stickersOpen = true)} />
</main>
{/if}

<ConfirmDialog />
{#if presetsOpen}<PresetSheet onPick={addBoard} onClose={() => (presetsOpen = false)} />{/if}
{#if stickersOpen}<StickerSheet onClose={() => (stickersOpen = false)} />{/if}
{#if settingsOpen}<SettingsSheet onClose={() => (settingsOpen = false)} />{/if}
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
