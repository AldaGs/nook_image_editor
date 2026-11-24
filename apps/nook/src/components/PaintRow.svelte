<!-- One paint (a fill or a stroke's colour): solid or gradient, opacity, visibility.
     `onchange(paint, done)` fires while dragging (done = false) and once at the end. -->
<script lang="ts" module>
  import type { GradientPaint, Paint, RGBA } from '@nook/engine';

  const hex2 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  export const toHex = (c: RGBA) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  export const fromHex = (h: string, a = 1): RGBA => ({
    r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255, a,
  });
  /** CSS for a swatch showing the paint. */
  export function swatch(p: Paint): string {
    const css = (c: RGBA) => `rgb(${c.r * 255} ${c.g * 255} ${c.b * 255} / ${c.a})`;
    if (p.kind === 'solid') return css(p.color);
    const stops = p.stops.map(s => `${css(s.color)} ${s.offset * 100}%`).join(', ');
    return p.kind === 'linear' ? `linear-gradient(90deg, ${stops})` : `radial-gradient(${stops})`;
  }
</script>

<script lang="ts">
  import { linear, solid } from '@nook/engine';
  import IconButton from './IconButton.svelte';

  let { paint, onchange, onremove, oneditgradient }: {
    paint: Paint;
    onchange: (p: Paint, done: boolean) => void;
    onremove: () => void;
    oneditgradient?: () => void;
  } = $props();

  function setKind(kind: Paint['kind']) {
    const base = { opacity: paint.opacity, blendMode: paint.blendMode, visible: paint.visible };
    if (kind === 'solid') {
      onchange({ ...solid(paint.kind === 'solid' ? paint.color : paint.stops[0]!.color), ...base }, true);
    } else if (paint.kind === 'solid') {
      // Colour fading to transparent, top to bottom (radial: centre outward).
      const g = { ...linear(paint.color, { ...paint.color, a: 0 }), ...base, kind };
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
      <input class="swatch" type="color" aria-label="Colour" value={toHex(paint.color)}
        oninput={e => onchange({ ...paint, color: fromHex(e.currentTarget.value, paint.color.a) } as Paint, false)}
        onchange={e => onchange({ ...paint, color: fromHex(e.currentTarget.value, paint.color.a) } as Paint, true)} />
    {:else}
      <button type="button" class="swatch" aria-label="Edit gradient on canvas" style:background={swatch(paint)} onclick={oneditgradient}></button>
    {/if}
    <select aria-label="Paint type" value={paint.kind} onchange={e => setKind(e.currentTarget.value as Paint['kind'])}>
      <option value="solid">Solid</option>
      <option value="linear">Linear</option>
      <option value="radial">Radial</option>
    </select>
    <label class="pct">
      <input type="number" inputmode="numeric" min="0" max="100" aria-label="Opacity" value={Math.round(paint.opacity * 100)}
        onchange={e => onchange({ ...paint, opacity: Math.min(1, Math.max(0, +e.currentTarget.value / 100)) }, true)} />%
    </label>
    <IconButton icon={paint.visible ? 'eye' : 'eyeOff'} label={paint.visible ? 'Hide' : 'Show'} onclick={() => onchange({ ...paint, visible: !paint.visible }, true)} />
    <IconButton icon="minus" label="Remove" onclick={onremove} />
  </div>

  {#if paint.kind !== 'solid'}
    {@const g = paint}
    {#each g.stops as stop, i (i)}
      <div class="row stop">
        <input class="swatch small" type="color" aria-label="Stop colour" value={toHex(stop.color)}
          oninput={e => setStop(g, i, { color: fromHex(e.currentTarget.value, stop.color.a) }, false)}
          onchange={e => setStop(g, i, { color: fromHex(e.currentTarget.value, stop.color.a) }, true)} />
        <input type="range" min="0" max="1" step="0.01" aria-label="Stop position" value={stop.offset} style:--fill="{stop.offset * 100}%"
          oninput={e => setStop(g, i, { offset: +e.currentTarget.value }, false)}
          onchange={e => setStop(g, i, { offset: +e.currentTarget.value }, true)} />
        <label class="pct">
          <input type="number" inputmode="numeric" min="0" max="100" aria-label="Stop opacity" value={Math.round(stop.color.a * 100)}
            onchange={e => setStop(g, i, { color: { ...stop.color, a: Math.min(1, Math.max(0, +e.currentTarget.value / 100)) } }, true)} />%
        </label>
        <IconButton icon="minus" label="Remove stop" disabled={g.stops.length <= 2}
          onclick={() => onchange({ ...g, stops: g.stops.filter((_, j) => j !== i) }, true)} />
      </div>
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
  .swatch {
    flex: none;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: none;
  }
  .swatch.small { width: 28px; height: 28px; }
  input[type='color']::-webkit-color-swatch-wrapper { padding: 2px; }
  input[type='color']::-webkit-color-swatch { border: none; border-radius: 6px; }
  select { flex: 1; min-width: 0; }
  input[type='range'] { flex: 1; min-width: 0; }
  .pct { display: flex; align-items: center; gap: 2px; color: var(--text-muted); font-size: 13px; }
  .pct input { width: 3.2em; }
  .text { background: none; border: none; color: var(--accent); font: inherit; font-size: 13px; min-height: var(--touch-target); padding: 0 6px; }
</style>
