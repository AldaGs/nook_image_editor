<!-- Design sheet for the selection: layer opacity and blend, fills, strokes, effects.
     Edits apply to every selected layer, starting from the first one's values. -->
<script lang="ts">
  import { BLEND_MODES, newEffect, solid, type BlendMode, type Effect, type MotionHints, type Node, type Paint, type Stroke, type TextProps } from '@nook/engine';
  import IconButton from './IconButton.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import PaintRow from './PaintRow.svelte';
  import Swatch from './Swatch.svelte';
  import Sheet from './Sheet.svelte';
  import { editor, ui } from '../lib/session.svelte';
  import { FONTS, weightsOf } from '../lib/fonts';
  import { motionRole } from '@nook/scene-export';

  let { onClose, onEditGradient }: {
    onClose: () => void;
    /** Close the sheet and drag this gradient's handles on the canvas. */
    onEditGradient: (target: 'fills' | 'strokes', index: number) => void;
  } = $props();

  // Shallow copies: the document mutates nodes in place, so a new object per version is what tells Svelte to redraw.
  const nodes = $derived.by(() => { ui.state.version; return editor.selectedNodes().map(x => ({ ...x })); });
  const n = $derived(nodes[0] as Node | undefined);
  const ids = $derived(nodes.map(x => x.id));
  /** Groups have no fills or strokes of their own. */
  const painted = $derived(!!n && n.type !== 'group');

  const EFFECTS: [Effect['kind'], string][] = [
    ['dropShadow', 'Drop shadow'], ['innerShadow', 'Inner shadow'], ['layerBlur', 'Layer blur'], ['backgroundBlur', 'Background blur'], ['outline', 'Sticker outline'], ['grain', 'Grain'], ['halftone', 'Halftone'],
  ];
  const label = (m: string) => m.replace(/[A-Z]/g, c => ` ${c.toLowerCase()}`).replace(/^./, c => c.toUpperCase());

  /** Live while dragging (done = false), one undo step when done. */
  function edit(prop: 'opacity' | 'blendMode' | 'fills' | 'strokes' | 'effects' | 'width' | 'height' | 'motion' | 'pointCount' | 'innerRatio', value: unknown, done = true) {
    editor.preview(ids, prop, value);
    if (done) editor.commitEdit();
  }
  const replace = <T,>(list: T[], i: number, item: T) => list.map((x, j) => (j === i ? item : x));
  const remove = <T,>(list: T[], i: number) => list.filter((_, j) => j !== i);
  const num = (v: string, min = -Infinity) => Math.max(min, Number.isFinite(+v) ? +v : 0);

  /** Text edits keep auto-sized boxes in step (one undo step each). */
  function text(patch: Partial<TextProps>) {
    editor.previewText(ids, patch);
    editor.commitEdit();
  }
  /** Line background: colour drags preview live, one undo step when done. */
  function textBg(bg: TextProps['background'], done = true) {
    editor.previewText(ids, { background: bg });
    if (done) editor.commitEdit();
  }
  let bgPicker = $state(false);
  const WEIGHT_NAMES: Record<number, string> = {
    100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black',
  };
  const nearestWeight = (family: string, w: number) => weightsOf(family).reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));

  /** Cut-out picture, white sticker outline and a soft shadow: one undo step. */
  function makeSticker(node: Node, i: number, cut: Paint) {
    const effects = [...node.effects.filter(e => e.kind !== 'outline'), newEffect('outline'),
      { kind: 'dropShadow', visible: true, color: { r: 0, g: 0, b: 0, a: 0.25 }, x: 0, y: 6, blur: 16, spread: 0 } satisfies Effect];
    editor.transact('Make sticker', () => [
      { t: 'set', id: node.id, prop: 'fills', value: replace(node.fills, i, cut) },
      { t: 'set', id: node.id, prop: 'effects', value: effects },
    ]);
  }

  /** The shadow whose colour picker is open, by effect index. */
  let shadowPicker = $state<number | null>(null);

  // New paints go on top, like Figma.
  const grey = () => solid({ r: 0.85, g: 0.85, b: 0.87, a: 1 });
  const addFill = (node: Node) => edit('fills', [...node.fills, grey()]);
  const addStroke = (node: Node) => edit('strokes', [...node.strokes, { paint: solid({ r: 0, g: 0, b: 0, a: 1 }), width: 2, align: 'inside' } satisfies Stroke]);
</script>

<Sheet title="Design" {onClose} peek>
  {#if n}
    <section>
      <h3>Layer</h3>
      <div class="row">
        <input type="range" min="0" max="1" step="0.01" aria-label="Layer opacity" value={n.opacity} style:--fill="{n.opacity * 100}%"
          oninput={e => edit('opacity', +e.currentTarget.value, false)} onchange={e => edit('opacity', +e.currentTarget.value)} />
        <span class="value">{Math.round(n.opacity * 100)}%</span>
      </div>
      <div class="row">
        <select aria-label="Blend mode" value={n.blendMode} onchange={e => edit('blendMode', e.currentTarget.value as BlendMode)}>
          {#each BLEND_MODES as m (m)}<option value={m}>{label(m)}</option>{/each}
        </select>
      </div>
    </section>

    {#if n.type === 'frame'}
      <section>
        <h3>Board</h3>
        <div class="row">
          <label class="field">W<input type="number" inputmode="numeric" min="1" value={Math.round(n.width)}
            onchange={e => edit('width', Math.round(num(e.currentTarget.value, 1)))} /></label>
          <label class="field">H<input type="number" inputmode="numeric" min="1" value={Math.round(n.height)}
            onchange={e => edit('height', Math.round(num(e.currentTarget.value, 1)))} /></label>
        </div>
      </section>
    {/if}

    {#if n.type === 'frame' || n.type === 'group'}
      {@const m = n.motion ?? {}}
      {@const topLevel = n.parentId === editor.pageId}
      <section>
        <h3>Motion</h3>
        <div class="row">
          <select aria-label="Motion role" value={m.role ?? ''}
            onchange={e => edit('motion', { ...m, role: (e.currentTarget.value || undefined) as MotionHints['role'] })}>
            <option value="">Auto ({topLevel ? 'comp' : motionRole({ ...n, motion: undefined }) === 'precomp' ? 'precomp' : 'layer group'})</option>
            {#if topLevel}<option value="comp">Comp</option>{/if}
            <option value="precomp">Precomp</option>
            {#if !topLevel}<option value="layer">Layer group</option>{/if}
          </select>
        </div>
        <p class="hint">{topLevel ? 'Each board is a comp in PBC.' : 'Precomps keep blend modes and effects, and clip boards. Layer groups stay editable in place.'}</p>
        <textarea aria-label="Motion notes" rows="2" placeholder="Notes for the animator" value={m.notes ?? ''}
          onchange={e => edit('motion', { ...m, notes: e.currentTarget.value.trim() || undefined })}></textarea>
      </section>
    {/if}

    {#if n.type === 'polygon' || n.type === 'star'}
      <section>
        <h3>{n.type === 'star' ? 'Star' : 'Polygon'}</h3>
        <div class="row wrap">
          <label class="field">{n.type === 'star' ? 'Points' : 'Sides'}<input type="number" inputmode="numeric" min="3" max="60" value={n.pointCount}
            onchange={e => edit('pointCount', Math.min(60, Math.max(3, Math.round(num(e.currentTarget.value, 3)))))} /></label>
          {#if n.type === 'star'}
            <label class="field">Inner<input type="number" inputmode="numeric" min="1" max="100" value={Math.round((n.innerRatio ?? 0.4) * 100)}
              onchange={e => edit('innerRatio', Math.min(1, Math.max(0.01, num(e.currentTarget.value, 1) / 100)))} />%</label>
          {/if}
        </div>
      </section>
    {/if}

    {#if n.type === 'text' && n.text}
      {@const t = n.text}
      <section>
        <h3>Text</h3>
        <div class="row">
          <select aria-label="Font" value={t.family}
            onchange={e => text({ family: e.currentTarget.value, weight: nearestWeight(e.currentTarget.value, t.weight) })}>
            {#each Object.keys(FONTS) as f (f)}<option value={f}>{f}</option>{/each}
          </select>
          <select aria-label="Weight" value={t.weight} onchange={e => text({ weight: +e.currentTarget.value })}>
            {#each weightsOf(t.family) as w (w)}<option value={w}>{WEIGHT_NAMES[w]}</option>{/each}
          </select>
        </div>
        <div class="row wrap">
          <label class="field">Size<input type="number" inputmode="decimal" min="1" value={t.size}
            onchange={e => text({ size: num(e.currentTarget.value, 1) })} /></label>
          <label class="field">Line<input type="number" inputmode="decimal" min="0" placeholder="Auto" value={t.lineHeight ?? ''}
            onchange={e => text({ lineHeight: e.currentTarget.value === '' ? null : num(e.currentTarget.value, 0) || null })} /></label>
          <label class="field">Spacing<input type="number" inputmode="decimal" value={t.letterSpacing}
            onchange={e => text({ letterSpacing: num(e.currentTarget.value) })} /></label>
        </div>
        <div class="row">
          <select aria-label="Alignment" value={t.align} onchange={e => text({ align: e.currentTarget.value as TextProps['align'] })}>
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
          <select aria-label="Box sizing" value={t.sizing} onchange={e => text({ sizing: e.currentTarget.value as TextProps['sizing'] })}>
            <option value="autoWidth">Auto width</option>
            <option value="autoHeight">Auto height</option>
            <option value="fixed">Fixed size</option>
          </select>
        </div>
        <div class="row wrap">
          <select aria-label="Line background" value={t.background?.style ?? 'none'}
            onchange={e => { const v = e.currentTarget.value; textBg(v === 'none' ? undefined
              : { color: { r: 1, g: 1, b: 1, a: 1 }, padding: Math.round(t.size * 0.4), ...t.background, style: v as 'pill' | 'highlight' | 'bubble' }); }}>
            <option value="none">No background</option>
            <option value="pill">Pill</option>
            <option value="highlight">Highlight</option>
            <option value="bubble">Bubble</option>
          </select>
          {#if t.background}
            {@const bg = t.background}
            <Swatch color={bg.color} label="Background colour" size={32} open={bgPicker} onclick={() => (bgPicker = !bgPicker)} />
            <label class="field">Padding<input type="number" inputmode="decimal" min="0" value={bg.padding}
              onchange={e => textBg({ ...bg, padding: num(e.currentTarget.value, 0) })} /></label>
            {#if bgPicker}
              <div class="full"><ColorPicker color={bg.color} onchange={(color, done) => textBg({ ...bg, color }, done)} /></div>
            {/if}
          {/if}
        </div>
        {#if t.background?.style === 'bubble'}
          {@const bg = t.background}
          {@const tail = { show: true, ...bg.tail }}
          <div class="row">
            <label class="field"><input class="check" type="checkbox" checked={tail.show}
              onchange={e => textBg({ ...bg, tail: { ...tail, show: e.currentTarget.checked } })} />Tail</label>
            {#if tail.show}
              <label class="field">Size<input type="number" inputmode="decimal" min="0" value={tail.size ?? Math.max(bg.padding, 12)}
                onchange={e => textBg({ ...bg, tail: { ...tail, size: num(e.currentTarget.value, 0) } })} /></label>
              <input type="range" aria-label="Tail position" min="0" max="1" step="0.01"
                value={tail.at ?? { left: 0, center: 0.5, right: 1 }[t.align]}
                oninput={e => textBg({ ...bg, tail: { ...tail, at: +e.currentTarget.value } }, false)}
                onchange={e => textBg({ ...bg, tail: { ...tail, at: +e.currentTarget.value } })} />
            {/if}
          </div>
        {/if}
      </section>
    {/if}

    {#if painted}
      <section>
        <header><h3>Fill</h3><IconButton icon="plus" label="Add fill" onclick={() => addFill(n)} /></header>
        <!-- Top paint first, as it stacks. -->
        {#each [...n.fills.keys()].reverse() as i (i)}
          <PaintRow paint={n.fills[i]!}
            onchange={(p: Paint, done) => edit('fills', replace(n.fills, i, p), done)}
            onremove={() => edit('fills', remove(n.fills, i))}
            oneditgradient={() => onEditGradient('fills', i)}
            onsticker={p => makeSticker(n, i, p)} />
        {/each}
      </section>

      <section>
        <header><h3>Stroke</h3><IconButton icon="plus" label="Add stroke" onclick={() => addStroke(n)} /></header>
        {#each [...n.strokes.keys()].reverse() as i (i)}
          {@const s = n.strokes[i]!}
          <PaintRow paint={s.paint}
            onchange={(p: Paint, done) => edit('strokes', replace(n.strokes, i, { ...s, paint: p }), done)}
            onremove={() => edit('strokes', remove(n.strokes, i))}
            oneditgradient={() => onEditGradient('strokes', i)} />
          <div class="row indent">
            <label class="field">Width
              <input type="number" inputmode="decimal" min="0" value={s.width}
                onchange={e => edit('strokes', replace(n.strokes, i, { ...s, width: num(e.currentTarget.value, 0) }))} />
            </label>
            <select aria-label="Stroke position" value={s.align}
              onchange={e => edit('strokes', replace(n.strokes, i, { ...s, align: e.currentTarget.value as Stroke['align'] }))}>
              <option value="inside">Inside</option>
              <option value="center">Centre</option>
              <option value="outside">Outside</option>
            </select>
          </div>
        {/each}
      </section>
    {/if}

    <section>
      <header>
        <h3>Effects</h3>
        <IconButton icon="plus" label="Add drop shadow" onclick={() => edit('effects', [...n.effects, newEffect('dropShadow')])} />
      </header>
      {#each n.effects as e, i (i)}
        <div class="row">
          <select aria-label="Effect" value={e.kind}
            onchange={ev => edit('effects', replace(n.effects, i, { ...newEffect(ev.currentTarget.value as Effect['kind']), visible: e.visible }))}>
            {#each EFFECTS as [k, name] (k)}<option value={k}>{name}</option>{/each}
          </select>
          <IconButton icon={e.visible ? 'eye' : 'eyeOff'} label={e.visible ? 'Hide' : 'Show'} onclick={() => edit('effects', replace(n.effects, i, { ...e, visible: !e.visible }))} />
          <IconButton icon="minus" label="Remove effect" onclick={() => { shadowPicker = null; edit('effects', remove(n.effects, i)); }} />
        </div>
        <div class="row indent wrap">
          {#if e.kind === 'dropShadow' || e.kind === 'innerShadow'}
            <Swatch color={e.color} label="Shadow colour" size={32} open={shadowPicker === i} onclick={() => (shadowPicker = shadowPicker === i ? null : i)} />
            <label class="field">X<input type="number" inputmode="decimal" value={e.x}
              onchange={ev => edit('effects', replace(n.effects, i, { ...e, x: num(ev.currentTarget.value) }))} /></label>
            <label class="field">Y<input type="number" inputmode="decimal" value={e.y}
              onchange={ev => edit('effects', replace(n.effects, i, { ...e, y: num(ev.currentTarget.value) }))} /></label>
            <label class="field">Blur<input type="number" inputmode="decimal" min="0" value={e.blur}
              onchange={ev => edit('effects', replace(n.effects, i, { ...e, blur: num(ev.currentTarget.value, 0) }))} /></label>
            <label class="field">Spread<input type="number" inputmode="decimal" value={e.spread}
              onchange={ev => edit('effects', replace(n.effects, i, { ...e, spread: num(ev.currentTarget.value) }))} /></label>
            {#if shadowPicker === i}
              <div class="full"><ColorPicker color={e.color} onchange={(color, done) => edit('effects', replace(n.effects, i, { ...e, color }), done)} /></div>
            {/if}
          {:else if e.kind === 'grain'}
            <label class="field">Amount<input type="number" inputmode="numeric" min="0" max="100" value={Math.round(e.amount * 100)}
              onchange={ev => edit('effects', replace(n.effects, i, { ...e, amount: Math.min(1, num(ev.currentTarget.value, 0) / 100) }))} />%</label>
            <label class="field">Size<input type="number" inputmode="decimal" min="0.5" step="0.5" value={e.size}
              onchange={ev => edit('effects', replace(n.effects, i, { ...e, size: num(ev.currentTarget.value, 0.5) }))} /></label>
          {:else if e.kind === 'halftone'}
            <label class="field">Dots<input type="number" inputmode="decimal" min="2" value={e.size}
              onchange={ev => edit('effects', replace(n.effects, i, { ...e, size: num(ev.currentTarget.value, 2) }))} /></label>
            <label class="field">Angle<input type="number" inputmode="decimal" value={e.angle}
              onchange={ev => edit('effects', replace(n.effects, i, { ...e, angle: num(ev.currentTarget.value) }))} /></label>
          {:else if e.kind === 'outline'}
            <Swatch color={e.color} label="Outline colour" size={32} open={shadowPicker === i} onclick={() => (shadowPicker = shadowPicker === i ? null : i)} />
            <label class="field">Width<input type="number" inputmode="decimal" min="0" value={e.width}
              onchange={ev => edit('effects', replace(n.effects, i, { ...e, width: num(ev.currentTarget.value, 0) }))} /></label>
            {#if shadowPicker === i}
              <div class="full"><ColorPicker color={e.color} onchange={(color, done) => edit('effects', replace(n.effects, i, { ...e, color }), done)} /></div>
            {/if}
          {:else if e.kind === 'layerBlur' || e.kind === 'backgroundBlur'}
            <label class="field">Blur<input type="number" inputmode="decimal" min="0" value={e.radius}
              onchange={ev => edit('effects', replace(n.effects, i, { ...e, radius: num(ev.currentTarget.value, 0) }))} /></label>
          {/if}
        </div>
      {/each}
    </section>
  {:else}
    <p class="empty">Select a layer to style it.</p>
  {/if}
</Sheet>

<style>
  section { padding: 4px var(--space) var(--space); border-top: 1px solid var(--border); }
  section:first-of-type { border-top: none; }
  header { display: flex; align-items: center; justify-content: space-between; }
  h3 { margin: 8px 0 4px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .row { min-width: 0; display: flex; align-items: center; gap: 6px; min-height: var(--touch-target); }
  .row.wrap { flex-wrap: wrap; }
  .indent { padding-left: 12px; }
  .row > input[type='range'] { flex: 1; }
  .row > select { flex: 1; min-width: 0; }
  .value { width: 3em; text-align: right; font-size: 13px; color: var(--text-muted); }
  .field { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-muted); }
  .field input { width: 3.6em; min-width: 0; }
  .field input.check { width: auto; }
  section { min-width: 0; }
  .full { flex-basis: 100%; }
  textarea { width: 100%; box-sizing: border-box; font: inherit; font-size: 16px; color: inherit; padding: 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; resize: vertical; user-select: text; -webkit-user-select: text; }
  .hint { margin: 0 0 6px; font-size: 12px; color: var(--text-muted); }
  .empty { padding: var(--space); color: var(--text-muted); }
</style>
