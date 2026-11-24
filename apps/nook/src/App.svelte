<!-- App layout: top bar, canvas, status bar, stacked for a phone screen. -->
<script lang="ts">
  import type { Engine } from '@nook/engine';
  import { onMount } from 'svelte';
  import { requestPersistence } from '@nook/storage';
  import Canvas from './components/Canvas.svelte';
  import TopBar from './components/TopBar.svelte';
  import StatusBar from './components/StatusBar.svelte';

  let engine = $state<Engine | null>(null);
  let zoom = $state(1);
  let fps = $state<number | null>(null);

  // Ask the browser not to evict local files (matters on iOS).
  onMount(() => { requestPersistence(); });

  function fit() {
    engine?.zoomToFit();
    if (engine) zoom = engine.camera.zoom;
  }
</script>

<main>
  <TopBar onFit={fit} />
  <Canvas bind:engine onFps={v => (fps = v)} onCameraChange={z => (zoom = z)} />
  <StatusBar {zoom} {fps} />
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
</style>
