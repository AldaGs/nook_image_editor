<!-- A colour swatch button: the colour over a checkerboard, so transparency shows. -->
<script lang="ts">
  import type { RGBA } from '@nook/engine';

  let { color, label = 'Colour', open = false, size = 36, onclick }: {
    color: RGBA;
    label?: string;
    open?: boolean;
    size?: number;
    onclick: () => void;
  } = $props();

  const css = $derived(`rgb(${color.r * 255} ${color.g * 255} ${color.b * 255} / ${color.a})`);
</script>

<button type="button" class:open aria-label={label} aria-expanded={open} style:--c={css} style:--size="{size}px" {onclick}></button>

<style>
  button {
    flex: none;
    width: var(--size);
    height: var(--size);
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background:
      linear-gradient(var(--c), var(--c)),
      repeating-conic-gradient(#d4d4d8 0 25%, #fff 0 50%) 0 0 / 10px 10px;
  }
  button.open { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
