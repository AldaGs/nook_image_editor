<!-- Status bar: zoom level and frame rate (the stage 0 "60 fps" check). -->
<script lang="ts">
  let { zoom, fps }: { zoom: number; fps: number | null } = $props();
</script>

<footer>
  <span>{Math.round(zoom * 100)}%</span>
  <span>{fps === null ? '–' : fps} fps</span>
</footer>

<style>
  footer {
    display: flex;
    justify-content: space-between;
    padding: var(--space) calc(var(--space) * 2) calc(var(--space) + env(safe-area-inset-bottom));
    background: var(--surface);
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    font-size: 12px;
  }
</style>
