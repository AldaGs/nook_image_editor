<!-- Canvas: hosts the engine on a <canvas>, plus the overlays drawn in HTML
     (frame labels, view info, selection actions). -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { createEngine, type Engine, type FrameLabel } from '@nook/engine';
  import wasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';
  import { canvasTheme } from '../lib/theme.svelte';
  import { canvasRef, editor } from '../lib/session.svelte';
  import { loadFont } from '../lib/fonts';
  import { imageFiles, importImages, loadAsset } from '../lib/assets';
  import ActionBar from './ActionBar.svelte';
  import FrameLabels from './FrameLabels.svelte';
  import TextInput from './TextInput.svelte';
  import ViewInfo from './ViewInfo.svelte';

  let { engine = $bindable(null), onDesign }: { engine?: Engine | null; onDesign: () => void } = $props();

  let canvas = $state<HTMLCanvasElement>();
  let error = $state<string | null>(null);
  let labels = $state<FrameLabel[]>([]);
  let zoom = $state(1);
  let fps = $state<number | null>(null);
  let fpsTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    let live: Engine | null = null;
    let disposed = false;

    createEngine(canvas!, {
      wasmUrl,
      editor,
      loadFont,
      loadAsset,
      theme: canvasTheme(),
      // Show fps while frames are drawn continuously; hide it shortly after they stop.
      onFps: v => { fps = v; clearTimeout(fpsTimer); fpsTimer = setTimeout(() => (fps = null), 1500); },
      // After each redraw, move the HTML overlays to match the camera.
      onView: () => { if (live) { labels = live.frameLabels(); zoom = live.camera.zoom; } },
    })
      .then(e => {
        if (disposed) return e.destroy();
        live = engine = canvasRef.engine = e;
        e.zoomToFit();
      })
      .catch(err => { error = err instanceof Error ? err.message : String(err); });

    canvasRef.canvas = canvas!;
    return () => { disposed = true; live?.destroy(); engine = canvasRef.engine = null; canvasRef.canvas = null; };
  });

  // Recolour the canvas when the system theme changes.
  $effect(() => { engine?.setTheme(canvasTheme()); });
</script>

<!-- Pictures dropped on the canvas land where they're dropped. -->
<div
  class="wrap"
  role="presentation"
  ondragover={e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); }}
  ondrop={e => {
    const files = imageFiles(e.dataTransfer?.files);
    if (!files.length) return;
    e.preventDefault();
    importImages(files, { x: e.clientX, y: e.clientY });
  }}
>
  <canvas bind:this={canvas}></canvas>
  <div class="overlay">
    <FrameLabels {labels} />
  </div>
  <ViewInfo {zoom} {fps} />
  <ActionBar {onDesign} />
  {#if canvas}<TextInput {engine} {canvas} />{/if}
  {#if error}
    <p class="status">{error}</p>
  {:else if !engine}
    <p class="status">Loading canvas…</p>
  {/if}
</div>

<style>
  .wrap { position: relative; flex: 1; min-height: 0; overflow: hidden; }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none; /* the engine handles every touch gesture itself */
  }
  /* Labels sit over the canvas but only the labels themselves take taps. */
  .overlay { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .overlay :global(button) { pointer-events: auto; }
  .status {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    color: var(--text-muted);
    pointer-events: none;
  }
</style>
