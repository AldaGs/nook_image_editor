<!-- Canvas: hosts the engine on a <canvas> and shows loading or error states. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { createEngine, type Engine } from '@nook/engine';
  import wasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';
  import { canvasTheme } from '../lib/theme.svelte';
  import { demoScene } from '../lib/demo';

  let { engine = $bindable(null), onFps, onCameraChange }: {
    engine?: Engine | null;
    onFps: (fps: number) => void;
    onCameraChange: (zoom: number) => void;
  } = $props();

  let canvas: HTMLCanvasElement;
  let error = $state<string | null>(null);

  onMount(() => {
    let live: Engine | null = null;
    let disposed = false;

    createEngine(canvas, { wasmUrl, theme: canvasTheme(), onFps })
      .then(e => {
        if (disposed) return e.destroy();
        live = engine = e;
        const t = canvasTheme();
        e.setNodes(demoScene(t.board, t.accent));
        e.zoomToFit();
        onCameraChange(e.camera.zoom);
      })
      .catch(err => { error = err instanceof Error ? err.message : String(err); });

    return () => { disposed = true; live?.destroy(); engine = null; };
  });

  // Recolour the canvas when the system theme changes.
  $effect(() => {
    const t = canvasTheme();
    if (!engine) return;
    engine.setTheme(t);
    engine.setNodes(demoScene(t.board, t.accent));
  });
</script>

<div class="wrap">
  <!-- Pointer moves can change zoom, so report it after each gesture. -->
  <canvas
    bind:this={canvas}
    onpointermove={() => engine && onCameraChange(engine.camera.zoom)}
    onwheel={() => engine && onCameraChange(engine.camera.zoom)}
  ></canvas>
  {#if error}
    <p class="overlay">{error}</p>
  {:else if !engine}
    <p class="overlay">Loading canvas…</p>
  {/if}
</div>

<style>
  .wrap { position: relative; flex: 1; min-height: 0; }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none; /* the engine handles every touch gesture itself */
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    color: var(--text-muted);
    pointer-events: none;
  }
</style>
