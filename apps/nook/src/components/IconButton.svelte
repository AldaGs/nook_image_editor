<!-- IconButton: a touch-sized button with an icon and an accessible label. -->
<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';

  let { icon, label, onclick, active = false, disabled = false }: {
    icon: IconName;
    label: string;
    onclick: () => void;
    active?: boolean;
    disabled?: boolean;
  } = $props();
</script>

<button type="button" class:active {disabled} aria-label={label} aria-pressed={active} title={label} {onclick}>
  <Icon name={icon} />
</button>

<style>
  button {
    display: inline-grid;
    place-items: center;
    min-width: var(--touch-target);
    min-height: var(--touch-target);
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--radius);
    font-size: 18px;
  }
  button:active:not(:disabled) { background: var(--border); }
  button.active { background: var(--accent); color: var(--on-accent); }
  button:disabled { opacity: 0.35; }
</style>
