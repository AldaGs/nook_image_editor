<!-- Top bar: app name and view actions. Sits below the phone's status-bar inset. -->
<script lang="ts">
  let { onFit }: { onFit: () => void } = $props();
</script>

<header>
  <span class="title">Nook</span>
  <button onclick={onFit} aria-label="Zoom to fit">Fit</button>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--bar-height);
    padding: env(safe-area-inset-top) calc(var(--space) * 2 + env(safe-area-inset-right)) 0 calc(var(--space) * 2 + env(safe-area-inset-left));
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .title { font-weight: 600; }
  button {
    min-width: var(--touch-target);
    min-height: var(--touch-target);
    padding: 0 calc(var(--space) * 1.5);
    background: none;
    border: none;
    border-radius: var(--radius);
    color: var(--accent);
    font-weight: 600;
  }
  button:active { background: var(--border); }
</style>
