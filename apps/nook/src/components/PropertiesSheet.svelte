<!-- Design sheet for the selection: layer opacity and blend, fills, strokes, effects.
     Edits apply to every selected layer, starting from the first one's values. -->
<script lang="ts">
  import { BLEND_MODES, newEffect, solid, type BlendMode, type Effect, type Node, type Paint, type Stroke } from '@nook/engine';
  import IconButton from './IconButton.svelte';
  import PaintRow, { fromHex, toHex } from './PaintRow.svelte';
  import Sheet from './Sheet.svelte';
  import { editor, ui } from '../lib/session.svelte';

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
    ['dropShadow', 'Drop shadow'], ['innerShadow', 'Inner shadow'], ['layerBlur', 'Layer blur'], ['backgroundBlur', 'Background blur'],
  ];
  const label = (m: string) => m.replace(/[A-Z]/g, c => ` ${c.toLowerCase()}`).replace(/^./, c => c.toUpperCase());

  /** Live while dragging (done = false), one undo step when done. */
  function edit(prop: 'opacity' | 'blendMode' | 'fills' | 'strokes' | 'effects', value: unknown, done = true) {
    editor.preview(ids, prop, value);
    if (done) editor.commitEdit();
  }
  const replace = <T,>(list: T[], i: number, item: T) => list.map((x, j) => (j === i ? item : x));
  const remove = <T,>(list: T[], i: number) => list.filter((_, j) => j !== i);
  const num = (v: string, min = -Infinity) => Math.max(min, Number.isFinite(+v) ? +v : 0);

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
        <input type="range" min="0" max="1" step="0.01" aria-label="Layer opacity" value={n.opacity}
          oninput={e => edit('opacity', +e.currentTarget.value, false)} onchange={e => edit('opacity', +e.currentTarget.value)} />
        <span class="value">{Math.round(n.opacity * 100)}%</span>
      </div>
      <div class="row">
        <select aria-label="Blend mode" value={n.blendMode} onchange={e => edit('blendMode', e.currentTarget.value as BlendMode)}>
          {#each BLEND_MODES as m (m)}<option value={m}>{label(m)}</option>{/each}
        </select>
      </div>
    </section>

    {#if painted}
      <section>
        <header><h3>Fill</h3><IconButton icon="plus" label="Add fill" onclick={() => addFill(n)} /></header>
        <!-- Top paint first, as it stacks. -->
        {#each [...n.fills.keys()].reverse() as i (i)}
          <PaintRow paint={n.fills[i]!}
            onchange={(p: Paint, done) => edit('fills', replace(n.fills, i, p), done)}
            onremove={() => edit('fills', remove(n.fills, i))}
            oneditgradient={() => onEditGradient('fills', i)} />
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
          <IconButton icon="minus" label="Remove effect" onclick={() => edit('effects', remove(n.effects, i))} />
        </div>
        <div class="row indent wrap">
          {#if e.kind === 'dropShadow' || e.kind === 'innerShadow'}
            <input class="swatch" type="color" aria-label="Shadow colour" value={toHex(e.color)}
              oninput={ev => edit('effects', replace(n.effects, i, { ...e, color: fromHex(ev.currentTarget.value, e.color.a) }), false)}
              onchange={ev => edit('effects', replace(n.effects, i, { ...e, color: fromHex(ev.currentTarget.value, e.color.a) }))} />
            <label class="field">A<input type="number" inputmode="numeric" min="0" max="100" value={Math.round(e.color.a * 100)}
              onchange={ev => edit('effects', replace(n.effects, i, { ...e, color: { ...e.color, a: Math.min(1, num(ev.currentTarget.value, 0) / 100) } }))} /></label>
            <label class="field">X<input type="number" inputmode="decimal" value={e.x}
              onchange={ev => edit('effects', replace(n.effects, i, { ...e, x: num(ev.currentTarget.value) }))} /></label>
            <label class="field">Y<input type="number" inputmode="decimal" value={e.y}
              onchange={ev => edit('effects', replace(n.effects, i, { ...e, y: num(ev.currentTarget.value) }))} /></label>
            <label class="field">Blur<input type="number" inputmode="decimal" min="0" value={e.blur}
              onchange={ev => edit('effects', replace(n.effects, i, { ...e, blur: num(ev.currentTarget.value, 0) }))} /></label>
            <label class="field">Spread<input type="number" inputmode="decimal" value={e.spread}
              onchange={ev => edit('effects', replace(n.effects, i, { ...e, spread: num(ev.currentTarget.value) }))} /></label>
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
  .row { display: flex; align-items: center; gap: 6px; min-height: var(--touch-target); }
  .row.wrap { flex-wrap: wrap; }
  .indent { padding-left: 12px; }
  .row > input[type='range'] { flex: 1; }
  .row > select { flex: 1; min-width: 0; }
  .value { width: 3em; text-align: right; font-size: 13px; color: var(--text-muted); }
  .field { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-muted); }
  .field input { width: 3.6em; }
  .swatch { width: 32px; height: 32px; padding: 0; border: 1px solid var(--border); border-radius: 8px; background: none; }
  .empty { padding: var(--space); color: var(--text-muted); }
</style>
