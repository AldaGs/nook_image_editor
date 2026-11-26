<!-- Export: boards as PNG/JPG/WebP at 1x–4x saved to the device or through the share sheet (a carousel
     when several are picked, in board order), or the board set as a PBC scene. -->
<script lang="ts">
  import { confirmAction } from '../lib/confirm.svelte';
  import { onMount } from 'svelte';
  import type { Engine, Node } from '@nook/engine';
  import Sheet from './Sheet.svelte';
  import { boardFiles, boardSvgs, canEncodeWebp, fitsLimit, type ImageFormat } from '../lib/export';
  import { downloadFiles, shareFiles } from '../lib/files';
  import { openNook, saveNook } from '../lib/nookfile';
  import { loadAsset, putAsset } from '../lib/assets';
  import { editor, openDocument } from '../lib/session.svelte';

  let { engine, onClose, onExportPbc }: { engine: Engine | null; onClose: () => void; onExportPbc: () => void } = $props();

  const boards = editor.doc.children(editor.pageId).filter(n => n.type === 'frame');
  // Default: the boards the selection is on, or every board.
  const topOf = (id: string) => [editor.doc.get(id)!, ...editor.doc.ancestors(id)].find(n => n.parentId === editor.pageId);
  const fromSelection = new Set(editor.selection.map(topOf).filter((n): n is Node => n?.type === 'frame').map(n => n.id));
  let chosen = $state(new Set(fromSelection.size ? fromSelection : boards.map(b => b.id)));
  let format = $state<ImageFormat>('png');
  let scale = $state(1);
  let webp = $state(false);
  let busy = $state(false);
  let ready = $state<File[] | null>(null); // rendered, waiting for a tap to share
  let message = $state<string | null>(null);

  onMount(() => { canEncodeWebp().then(ok => (webp = ok)); });

  const picked = $derived(boards.filter(b => chosen.has(b.id)));
  const fits = (s: number) => picked.every(b => fitsLimit(b, s));
  // A size that stopped fitting (new boards picked) steps down.
  $effect(() => { if (!fits(scale)) scale = [3, 2, 1].find(fits) ?? 1; });

  function toggle(id: string) {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id); else next.add(id);
    chosen = next;
    ready = null;
  }

  async function share(files: File[]) {
    const r = await shareFiles(files);
    if (r === 'retry') { ready = files; message = 'Ready. Tap Share to open the share sheet.'; return; }
    ready = null;
    if (r === 'shared' || r === 'downloaded') onClose();
  }

  async function exportImages(mode: 'save' | 'share') {
    if (ready && mode === 'share') return share(ready);
    if (!engine || !picked.length) return;
    busy = true;
    message = null;
    try {
      const files = ready ?? await boardFiles(engine, picked, scale, format);
      if (mode === 'save') { downloadFiles(files); ready = null; onClose(); }
      else await share(files);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function exportSvgs() {
    if (!engine || !picked.length) return;
    busy = true;
    message = null;
    try {
      const { files, report } = await boardSvgs(engine, picked, editor.doc);
      await share(files);
      if (report.length) message = `Exported with notes:\n• ${report.join('\n• ')}`;
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  // ── .nook files ──────────────────────────────────────────────
  let opener: HTMLInputElement;

  async function saveFile() {
    busy = true;
    message = null;
    try {
      const day = new Date().toISOString().slice(0, 10);
      await share([await saveNook(editor.doc, loadAsset, `Nook ${day}`)]);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function openFile(file: File | undefined) {
    if (!file) return;
    if (!(await confirmAction('Open this file?', 'It replaces the current document. Save the current one first if you want to keep it.', 'Open file'))) return;
    try {
      await openDocument(await openNook(file, putAsset));
      engine?.zoomToFit();
      onClose();
    } catch (e) {
      message = `Couldn't open "${file.name}": ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const count = $derived(picked.length);
  const first = $derived(picked[0]);
</script>

<Sheet title="Export" {onClose}>
  <section>
    <h3>Boards</h3>
    {#each boards as b (b.id)}
      <label class="board">
        <input type="checkbox" checked={chosen.has(b.id)} onchange={() => toggle(b.id)} />
        <span class="name">{b.name}</span>
        <span class="muted">{Math.round(b.width)}×{Math.round(b.height)}</span>
      </label>
    {/each}
  </section>

  <section>
    <h3>Format</h3>
    <div class="segments" role="radiogroup" aria-label="Format">
      {#each [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']] as [f, label] (f)}
        <button type="button" role="radio" aria-checked={format === f} class:on={format === f}
          disabled={f === 'webp' && !webp} onclick={() => { format = f as ImageFormat; ready = null; }}>{label}</button>
      {/each}
    </div>
    <h3>Size</h3>
    <div class="segments" role="radiogroup" aria-label="Size">
      {#each [1, 2, 3, 4] as s (s)}
        <button type="button" role="radio" aria-checked={scale === s} class:on={scale === s}
          disabled={!fits(s)} title={fits(s) ? undefined : 'Too big for phones to make'}
          onclick={() => { scale = s; ready = null; }}>{s}x</button>
      {/each}
    </div>
    {#if first}<p class="muted">{Math.round(first.width * scale)}×{Math.round(first.height * scale)} px{count > 1 ? ' for the first board' : ''}</p>{/if}
  </section>

  <section>
    {#if message}<p class="message">{message}</p>{/if}
    <button type="button" class="primary" disabled={!count || busy || !engine} onclick={() => exportImages('save')}>
      {busy ? 'Preparing…' : count > 1 ? `Save ${count} images` : count ? 'Save image' : 'Pick a board'}
    </button>
    <button type="button" class="secondary" disabled={!count || busy || !engine} onclick={() => exportImages('share')}>
      {ready ? 'Share' : 'Share…'}
    </button>
    <button type="button" class="secondary" disabled={!count || busy || !engine} onclick={exportSvgs}>SVG (vector)</button>
    <button type="button" class="secondary" onclick={onExportPbc}>PBC scene (.pbc)</button>
  </section>

  <section>
    <h3>Document</h3>
    <div class="pair">
      <button type="button" class="secondary" disabled={busy} onclick={saveFile}>Save .nook file</button>
      <button type="button" class="secondary" onclick={() => opener.click()}>Open .nook file</button>
    </div>
    <!-- No accept filter: iOS greys out extensions it doesn't know. The file is checked when opened. -->
    <input bind:this={opener} type="file" hidden onchange={e => { openFile(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
  </section>
</Sheet>

<style>
  section { padding: 4px var(--space) var(--space); border-top: 1px solid var(--border); }
  section:first-of-type { border-top: none; }
  h3 { margin: 8px 0 4px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .board { display: flex; align-items: center; gap: 10px; min-height: var(--touch-target); }
  .board input { width: 20px; height: 20px; accent-color: var(--accent); }
  .name { flex: 1; }
  .muted { color: var(--text-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  p.muted { margin: 6px 0 0; }
  .segments { display: flex; gap: 2px; padding: 2px; background: var(--bg); border-radius: 10px; }
  .segments button {
    flex: 1;
    min-height: 36px;
    border: none;
    border-radius: 8px;
    background: none;
    font-size: 14px;
  }
  .segments button.on { background: var(--surface); box-shadow: 0 1px 3px rgb(0 0 0 / 0.12); font-weight: 600; }
  .segments button:disabled { opacity: 0.35; }
  .primary, .secondary {
    display: block;
    width: 100%;
    min-height: 48px;
    margin-top: 8px;
    border-radius: 12px;
    font-size: 16px;
    font-weight: 600;
  }
  .primary { border: none; background: var(--accent); color: var(--on-accent); }
  .primary:disabled { opacity: 0.4; }
  .secondary { border: 1px solid var(--border); background: none; }
  .message { margin: 4px 0; font-size: 13px; }
  .pair { display: flex; gap: 8px; }
  .pair button { flex: 1; }
</style>
