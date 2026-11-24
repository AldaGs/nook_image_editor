<!-- Canvas: hosts the engine on a <canvas>, plus the overlays drawn in HTML
     (frame labels, view info, selection actions). -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { createEngine, type Engine, type FrameLabel } from '@nook/engine';
  import wasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';
  import { canvasTheme } from '../lib/theme.svelte';
  import { editor } from '../lib/session.svelte';
  import ActionBar from './ActionBar.svelte';
  import FrameLabels from './FrameLabels.svelte';
  import ViewInfo from './ViewInfo.svelte';

  let { engine = $bindable(null), onDesign }: { engine?: Engine | null; onDesign: () => void } = $props();

  let canvas: HTMLCanvasElement;
  let error = $state<string | null>(null);
  let labels = $state<FrameLabel[]>([]);
  let zoom = $state(1);
  let fps = $state<number | null>(null);
  let fpsTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    let live: Engine | null = null;
    let disposed = false;

    createEngine(canvas, {
      wasmUrl,
      editor,
      theme: canvasTheme(),
      // Show fps while frames are drawn continuously; hide it shortly after they stop.
      onFps: v => { fps = v; clearTimeout(fpsTimer); fpsTimer = setTimeout(() => (fps = null), 1500); },
      // After each redraw, move the HTML overlays to match the camera.
      onView: () => { if (live) { labels = live.frameLabels(); zoom = live.camera.zoom; } },
    })
      .then(e => {
        if (disposed) return e.destroy();
        live = engine = e;
        e.zoomToFit();
      })
      .catch(err => { error = err instanceof Error ? err.message : String(err); });

    return () => { disposed = true; live?.destroy(); engine = null; };
  });

  // Recolour the canvas when the system theme changes.
  $effect(() => { engine?.setTheme(canvasTheme()); });
</script>

<div class="wrap">
  <canvas bind:this={canvas}></canvas>
  <div class="overlay">
    <FrameLabels {labels} />
  </div>
  <ViewInfo {zoom} {fps} />
  <ActionBar {onDesign} />
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
