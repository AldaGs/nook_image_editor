<!-- One paint (a fill or a stroke's colour): solid or gradient, opacity, visibility.
     `onchange(paint, done)` fires while dragging (done = false) and once at the end. -->
<script lang="ts" module>
  import type { GradientPaint, Paint, RGBA } from '@nook/engine';

  /** CSS for a swatch showing the paint. */
  export function swatch(p: Paint): string {
    const css = (c: RGBA) => `rgb(${c.r * 255} ${c.g * 255} ${c.b * 255} / ${c.a})`;
    if (p.kind === 'solid') return css(p.color);
    if (p.kind === 'image') return 'var(--border)';
    const stops = p.stops.map(s => `${css(s.color)} ${s.offset * 100}%`).join(', ');
    return p.kind === 'linear' ? `linear-gradient(90deg, ${stops})` : `radial-gradient(${stops})`;
  }
</script>

<script lang="ts">
  import { isGradient, linear, solid } from '@nook/engine';
  import { loadAsset } from '../lib/assets';
  import ColorPicker from './ColorPicker.svelte';
  import IconButton from './IconButton.svelte';
  import Swatch from './Swatch.svelte';

  /** Which colour's picker is open: the solid paint, or a gradient stop by index. */
  let open = $state<'paint' | number | null>(null);
  const toggle = (which: 'paint' | number) => (open = open === which ? null : which);

  let { paint, onchange, onremove, oneditgradient }: {
    paint: Paint;
    onchange: (p: Paint, done: boolean) => void;
    onremove: () => void;
    oneditgradient?: () => void;
  } = $props();

  // A thumbnail for picture paints, from the stored file.
  let thumb = $state<string | null>(null);
  $effect(() => {
    if (paint.kind !== 'image') return;
    let url: string | null = null, live = true;
    loadAsset(paint.assetId).then(b => { if (live && b) thumb = url = URL.createObjectURL(new Blob([b])); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  });

  /** Solid ↔ linear ↔ radial (pictures only come in through Add picture, drop or paste). */
  function setKind(kind: 'solid' | 'linear' | 'radial') {
    const base = { opacity: paint.opacity, blendMode: paint.blendMode, visible: paint.visible };
    const from = paint.kind === 'solid' ? paint.color : paint.kind === 'image' ? { r: 0.85, g: 0.85, b: 0.87, a: 1 } : paint.stops[0]!.color;
    if (kind === 'solid') {
      onchange({ ...solid(from), ...base }, true);
    } else if (!isGradient(paint)) {
      // Colour fading to transparent, top to bottom (radial: centre outward).
      const g = { ...linear(from, { ...from, a: 0 }), ...base, kind };
      if (kind === 'radial') Object.assign(g, { from: { x: 0.5, y: 0.5 }, to: { x: 1, y: 0.5 } });
      onchange(g, true);
    } else {
      onchange({ ...paint, kind }, true);
    }
  }

  function setStop(g: GradientPaint, i: number, patch: Partial<GradientPaint['stops'][number]>, done: boolean) {
    const stops = g.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)).sort((a, b) => a.offset - b.offset);
    onchange({ ...g, stops }, done);
  }

  function addStop(g: GradientPaint) {
    // Halfway along the widest gap, in the colour already there.
    let at = 0, gap = -1;
    for (let i = 0; i < g.stops.length - 1; i++) {
      const d = g.stops[i + 1]!.offset - g.stops[i]!.offset;
      if (d > gap) { gap = d; at = i; }
    }
    const a = g.stops[at]!, b = g.stops[at + 1] ?? a;
    const mid = { offset: (a.offset + b.offset) / 2, color: { ...a.color } };
    onchange({ ...g, stops: [...g.stops, mid].sort((x, y) => x.offset - y.offset) }, true);
  }
</script>

<div class="paint">
  <div class="row">
    {#if paint.kind === 'solid'}
      <Swatch color={paint.color} open={open === 'paint'} onclick={() => toggle('paint')} />
    {:else if paint.kind === 'image'}
      {@const img = paint}
      <span class="swatch thumb" style:background-image={thumb ? `url(${thumb})` : 'none'} role="img" aria-label="Picture"></span>
      <select aria-label="Picture scaling" value={img.scaleMode}
        onchange={e => onchange({ ...img, scaleMode: e.currentTarget.value as 'fill' | 'fit' }, true)}>
        <option value="fill">Fill</option>
        <option value="fit">Fit</option>
      </select>
    {:else}
      <button type="button" class="swatch" aria-label="Edit gradient on canvas" style:background={swatch(paint)} onclick={oneditgradient}></button>
    {/if}
    {#if paint.kind !== 'image'}
      <select aria-label="Paint type" value={paint.kind} onchange={e => setKind(e.currentTarget.value as 'solid' | 'linear' | 'radial')}>
        <option value="solid">Solid</option>
        <option value="linear">Linear</option>
        <option value="radial">Radial</option>
      </select>
    {/if}
    <label class="pct">
      <input type="number" inputmode="numeric" min="0" max="100" aria-label="Opacity" value={Math.round(paint.opacity * 100)}
        onchange={e => onchange({ ...paint, opacity: Math.min(1, Math.max(0, +e.currentTarget.value / 100)) }, true)} />%
    </label>
    <IconButton icon={paint.visible ? 'eye' : 'eyeOff'} label={paint.visible ? 'Hide' : 'Show'} onclick={() => onchange({ ...paint, visible: !paint.visible }, true)} />
    <IconButton icon="minus" label="Remove" onclick={onremove} />
  </div>
  {#if paint.kind === 'solid' && open === 'paint'}
    {@const p = paint}
    <ColorPicker color={p.color} onchange={(color, done) => onchange({ ...p, color }, done)} />
  {/if}

  {#if isGradient(paint)}
    {@const g = paint}
    {#each g.stops as stop, i (i)}
      <div class="row stop">
        <Swatch color={stop.color} label="Stop colour" size={28} open={open === i} onclick={() => toggle(i)} />
        <input type="range" min="0" max="1" step="0.01" aria-label="Stop position" value={stop.offset} style:--fill="{stop.offset * 100}%"
          oninput={e => setStop(g, i, { offset: +e.currentTarget.value }, false)}
          onchange={e => setStop(g, i, { offset: +e.currentTarget.value }, true)} />
        <label class="pct">
          <input type="number" inputmode="numeric" min="0" max="100" aria-label="Stop opacity" value={Math.round(stop.color.a * 100)}
            onchange={e => setStop(g, i, { color: { ...stop.color, a: Math.min(1, Math.max(0, +e.currentTarget.value / 100)) } }, true)} />%
        </label>
        <IconButton icon="minus" label="Remove stop" disabled={g.stops.length <= 2}
          onclick={() => { open = null; onchange({ ...g, stops: g.stops.filter((_, j) => j !== i) }, true); }} />
      </div>
      {#if open === i}
        <div class="stop"><ColorPicker color={stop.color} onchange={(color, done) => setStop(g, i, { color }, done)} /></div>
      {/if}
    {/each}
    <div class="row">
      <button type="button" class="text" onclick={() => addStop(g)}>Add stop</button>
      {#if oneditgradient}<button type="button" class="text" onclick={oneditgradient}>Edit on canvas</button>{/if}
    </div>
  {/if}
</div>

<style>
  .paint { display: grid; gap: 2px; }
  .row { display: flex; align-items: center; gap: 6px; min-height: var(--touch-target); }
  .stop { padding-left: 12px; }
  .thumb { background: var(--border) center / cover no-repeat; }
  .swatch {
    flex: none;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: none;
  }
  select { flex: 1; min-width: 0; }
  input[type='range'] { flex: 1; min-width: 0; }
  .pct { display: flex; align-items: center; gap: 2px; color: var(--text-muted); font-size: 13px; }
  .pct input { width: 3.2em; }
  .text { background: none; border: none; color: var(--accent); font: inherit; font-size: 13px; min-height: var(--touch-target); padding: 0 6px; }
</style>
