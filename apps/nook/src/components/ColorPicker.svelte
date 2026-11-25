<!-- Colour picker: saturation/brightness square, hue and alpha sliders, hex and
     alpha fields, an eyedropper that samples the canvas, and the colours the
     document already uses. `onchange(colour, done)` fires live while dragging
     (done = false) and once when a gesture ends, so each gesture is one undo step. -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { documentColors, hsvToRgb, parseHex, rgbToHsv, toHex, type HSVA, type RGBA } from '@nook/engine';
  import IconButton from './IconButton.svelte';
  import { cancelPick, editor, eyedropper, pickFromCanvas, ui } from '../lib/session.svelte';

  let { color, onchange }: { color: RGBA; onchange: (c: RGBA, done: boolean) => void } = $props();

  // Work in HSV so the hue survives dragging into gray, black or white.
  let hsv = $state<HSVA>(rgbToHsv(untrack(() => color)));
  $effect(() => {
    // Follow outside changes (undo, another field), keeping our hue when the colour has none.
    if (toHex(color, true) === toHex(hsvToRgb(hsv), true)) return;
    const next = rgbToHsv(color);
    hsv = next.s === 0 || next.v === 0 ? { ...next, h: hsv.h } : next;
  });

  function set(patch: Partial<HSVA>, done: boolean) {
    hsv = { ...hsv, ...patch };
    onchange(hsvToRgb(hsv), done);
  }

  // ── The square ───────────────────────────────────────────────
  let square: HTMLDivElement;
  function fromPointer(e: PointerEvent, done: boolean) {
    const r = square.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    set({ s, v }, done);
  }
  function squareKey(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.01;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    set({ s: Math.min(1, Math.max(0, hsv.s + d[0]!)), v: Math.min(1, Math.max(0, hsv.v + d[1]!)) }, true);
  }

  const rgb = $derived(hsvToRgb(hsv));
  const css = (c: RGBA, a = c.a) => `rgb(${c.r * 255} ${c.g * 255} ${c.b * 255} / ${a})`;
  const swatches = $derived.by(() => { ui.state.version; return documentColors(editor.doc); });

  async function eyedrop() {
    if (eyedropper.active) return cancelPick();
    const picked = await pickFromCanvas();
    if (picked) onchange({ ...picked, a: color.a }, true);
  }
</script>

<div class="picker" style:--hue="hsl({hsv.h} 100% 50%)" style:--rgb={css(rgb, 1)}>
  <div
    class="square"
    bind:this={square}
    role="slider"
    tabindex="0"
    aria-label="Saturation and brightness"
    aria-valuenow={Math.round(hsv.v * 100)}
    aria-valuetext="Saturation {Math.round(hsv.s * 100)}%, brightness {Math.round(hsv.v * 100)}%"
    onpointerdown={e => { square.setPointerCapture(e.pointerId); fromPointer(e, false); }}
    onpointermove={e => { if (square.hasPointerCapture(e.pointerId)) fromPointer(e, false); }}
    onpointerup={e => fromPointer(e, true)}
    onpointercancel={e => fromPointer(e, true)}
    onkeydown={squareKey}
  >
    <span class="thumb" style:left="{hsv.s * 100}%" style:top="{(1 - hsv.v) * 100}%"></span>
  </div>

  <div class="row">
    <IconButton icon="pipette" label={eyedropper.active ? 'Cancel: tap the canvas to pick' : 'Pick a colour from the canvas'} active={eyedropper.active} onclick={eyedrop} />
    <div class="sliders">
      <input class="hue" type="range" min="0" max="360" step="1" aria-label="Hue" value={hsv.h}
        oninput={e => set({ h: +e.currentTarget.value }, false)} onchange={e => set({ h: +e.currentTarget.value }, true)} />
      <input class="alpha" type="range" min="0" max="1" step="0.01" aria-label="Opacity" value={hsv.a}
        oninput={e => set({ a: +e.currentTarget.value }, false)} onchange={e => set({ a: +e.currentTarget.value }, true)} />
    </div>
  </div>
  {#if eyedropper.active}<p class="hint">Tap a colour on the canvas.</p>{/if}

  <div class="row">
    <label class="field hex">Hex
      <input type="text" inputmode="text" autocapitalize="off" spellcheck="false" maxlength="9" value={toHex(color).slice(1).toUpperCase()}
        onchange={e => {
          const c = parseHex(e.currentTarget.value);
          if (c) onchange({ ...c, a: e.currentTarget.value.replace('#', '').length > 6 ? c.a : color.a }, true);
          else e.currentTarget.value = toHex(color).slice(1).toUpperCase();
        }} />
    </label>
    <label class="field">
      <input type="number" inputmode="numeric" min="0" max="100" aria-label="Opacity percent" value={Math.round(color.a * 100)}
        onchange={e => set({ a: Math.min(1, Math.max(0, +e.currentTarget.value / 100)) }, true)} />%
    </label>
  </div>

  {#if swatches.length}
    <div class="swatches" role="group" aria-label="Colours in this document">
      {#each swatches as c (toHex(c, true))}
        <button type="button" aria-label="Use {toHex(c, true)}" style:--c={css(c)} onclick={() => onchange(c, true)}></button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .picker { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; padding: 6px 0 10px; }
  .square {
    position: relative;
    height: 160px;
    border-radius: 10px;
    background: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, var(--hue));
    touch-action: none; /* the square owns the finger: no page scroll while dragging */
    cursor: crosshair;
  }
  .square:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .thumb {
    position: absolute;
    width: 22px;
    height: 22px;
    margin: -11px 0 0 -11px;
    border: 3px solid #fff;
    border-radius: 50%;
    background: var(--rgb);
    box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.2), 0 2px 6px rgb(0 0 0 / 0.3);
    box-sizing: border-box;
    pointer-events: none;
  }
  .row { display: flex; align-items: center; gap: 8px; }
  .sliders { flex: 1; display: grid; }
  .hint { margin: 0; font-size: 12px; color: var(--text-muted); }

  /* Colour tracks are thicker than plain sliders, and show what they set. */
  .sliders input { min-height: 34px; }
  .sliders input::-webkit-slider-runnable-track { height: 12px; border-radius: 6px; }
  .sliders input::-webkit-slider-thumb { margin-top: -8px; }
  .sliders input::-moz-range-track { height: 12px; border-radius: 6px; }
  .sliders input::-moz-range-progress { background: transparent; }
  .hue::-webkit-slider-runnable-track { background: linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red); }
  .hue::-moz-range-track { background: linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red); }
  .alpha::-webkit-slider-runnable-track {
    background: linear-gradient(to right, transparent, var(--rgb)), repeating-conic-gradient(#d4d4d8 0 25%, #fff 0 50%) 0 0 / 8px 8px;
  }
  .alpha::-moz-range-track {
    background: linear-gradient(to right, transparent, var(--rgb)), repeating-conic-gradient(#d4d4d8 0 25%, #fff 0 50%) 0 0 / 8px 8px;
  }

  .field { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-muted); }
  .field input { width: 3.6em; }
  .hex { flex: 1; }
  .hex input { flex: 1; width: auto; min-width: 0; font-family: ui-monospace, monospace; text-transform: uppercase; }

  .swatches { display: flex; gap: 6px; overflow-x: auto; padding: 4px 0; }
  .swatches button {
    flex: none;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 50%;
    background: linear-gradient(var(--c), var(--c)), repeating-conic-gradient(#d4d4d8 0 25%, #fff 0 50%) 0 0 / 8px 8px;
  }
</style>
