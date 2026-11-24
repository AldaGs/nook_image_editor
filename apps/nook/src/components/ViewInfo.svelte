<!-- Zoom and frame rate in the corner of the canvas (frame rate only while moving). -->
<script lang="ts">
  let { zoom, fps }: { zoom: number; fps: number | null } = $props();
</script>

<div>{Math.round(zoom * 100)}%{#if fps !== null} · {fps} fps{/if}</div>

<style>
  div {
    position: absolute;
    top: var(--space);
    right: calc(var(--space) + env(safe-area-inset-right));
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
</style>
