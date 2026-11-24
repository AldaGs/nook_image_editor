// Nook → PBC (.pbc) export. Each top-level frame becomes a comp; its contents
// become layers with names, hierarchy, position, rotation, size, paint, text,
// blend mode and effects intact. Groups become PBC group layers.
//
// Format reference: _pbc/crates/core/src/node.rs (Project, Comp, Node,
// Transform, Shape, Gradient) and effect.rs. Values are written as
// `{ "Const": … }` (not animated yet). Anything PBC can't represent is listed
// in the report, never guessed.

import {
  affine, estimateText, paintColor,
  type Doc, type Effect, type Node, type Point, type RGBA, type TextProps,
} from '@nook/engine';

export interface PbcExport {
  /** Text of the .pbc file. */
  text: string;
  /** Human-readable notes about what was dropped or changed. */
  report: string[];
}

/**
 * The laid-out text block: its widest line and its height, wrapped at `width`
 * (or one line per paragraph when null). PBC centres text on this block.
 */
export type MeasureLines = (t: TextProps, width: number | null) => { width: number; height: number };

interface Options {
  fps?: number;
  /** Comp length in seconds. */
  seconds?: number;
  /** Real text measurement (the engine's); a rough estimate otherwise. */
  measure?: MeasureLines;
}

const k = <T>(v: T) => ({ Const: v });
const vec3 = (x: number, y: number, z = 0) => ({ x, y, z });
const round = (v: number) => Math.round(v * 1000) / 1000;
/** 'colorDodge' → 'ColorDodge', PBC's names for the same 16 modes. */
const pascal = (s: string) => s[0]!.toUpperCase() + s.slice(1);

const estimateLines: MeasureLines = (t, width) => {
  const one = estimateText(t, null).width;
  return { width: width === null ? one : Math.min(one, width), height: estimateText(t, width).height };
};

interface Ctx { id: () => number; report: string[]; measure: MeasureLines; fonts: Set<string> }

export function exportPbc(doc: Doc, pageId: string, opts: Options = {}): PbcExport {
  const fps = opts.fps ?? 30;
  const seconds = opts.seconds ?? 5;
  const report: string[] = [];
  const fonts = new Set<string>();
  const comps: Record<string, unknown> = {};
  let nextComp = 1;

  for (const top of doc.children(pageId)) {
    if (top.type !== 'frame') {
      report.push(`"${top.name}" is outside any frame, so it isn't in a comp.`);
      continue;
    }
    // Ids are per comp, from 1 (0 is the comp's root group).
    let nextId = 1;
    const ctx: Ctx = { id: () => nextId++, report, measure: opts.measure ?? estimateLines, fonts };
    const fills = top.fills.filter(f => f.visible);
    const bg = fills.length ? withOpacity(paintColor(fills[fills.length - 1]!), fills[fills.length - 1]!.opacity) : { r: 1, g: 1, b: 1, a: 1 };
    if (Math.abs(affine.angleOf(top.transform)) > 1e-6) report.push(`Frame "${top.name}" is rotated; comps can't be, so the rotation was dropped.`);
    if (fills.length > 1 || fills.some(f => f.kind !== 'solid')) report.push(`Frame "${top.name}": a comp background is one flat colour, so its fills were flattened.`);
    if (top.strokes.some(s => s.paint.visible) || top.effects.some(e => e.visible)) report.push(`Frame "${top.name}": strokes and effects on a board itself aren't exported (a comp has neither).`);

    comps[String(nextComp++)] = {
      name: top.name,
      width: Math.round(top.width),
      height: Math.round(top.height),
      fps,
      duration_frames: Math.round(fps * seconds),
      bg,
      root: {
        ...baseLayer(0, 'root'),
        // Children draw back-to-front in PBC too.
        children: doc.children(top.id).map(n => toLayer(doc, n, ctx)),
      },
    };
  }

  if (nextComp === 1) report.push('There are no frames to export.');
  if (fonts.size) report.push(`Fonts used: ${[...fonts].join(', ')}. PBC finds fonts by name, so install them on the computer that opens this file.`);
  const project = { comps, root: 1 };
  return { text: JSON.stringify({ project }, null, 2), report };
}

/** One Nook node as a PBC layer (recursively for groups and nested frames). */
function toLayer(doc: Doc, n: Node, ctx: Ctx): unknown {
  const { report } = ctx;
  const { sx, sy } = affine.scaleOf(n.transform);
  const angle = (affine.angleOf(n.transform) * 180) / Math.PI;
  if (Math.abs(sx - 1) > 1e-3 || Math.abs(Math.abs(sy) - 1) > 1e-3) report.push(`"${n.name}" has a scaled transform; it was exported unscaled.`);

  const layer = {
    ...baseLayer(ctx.id(), n.name),
    hidden: !n.visible,
    locked: n.locked,
    blend: pascal(n.blendMode),
    effects: effects(n, report),
  };

  switch (n.type) {
    case 'rect':
    case 'ellipse':
    case 'text': {
      // PBC shapes (and text blocks) are centred on their position: find that
      // centre in the node's own space, then carry it into the parent.
      let centre = { x: n.width / 2, y: n.height / 2 };
      let shape: unknown;
      if (n.type === 'text') {
        const t = n.text!;
        ctx.fonts.add(t.family);
        const maxWidth = t.sizing === 'autoWidth' ? null : n.width;
        const block = ctx.measure(t, maxWidth);
        // Nook lines align inside the box; PBC's inside the block, which is then centred.
        const x = t.align === 'left' ? block.width / 2 : t.align === 'right' ? n.width - block.width / 2 : n.width / 2;
        centre = { x, y: block.height / 2 };
        shape = {
          Text: {
            content: k(t.content),
            family: t.family,
            weight: k(t.weight),
            italic: false,
            size: k(t.size),
            tracking: k(round((t.letterSpacing / t.size) * 1000)), // 1/1000 em
            leading: k(t.lineHeight ?? 0),                          // 0 = the font's own
            align: pascal(t.align),
            max_width: maxWidth,
          },
        };
      } else {
        const size = k({ x: n.width, y: n.height });
        shape = n.type === 'rect' ? { Rect: { size, radius: k(n.cornerRadius ?? 0) } } : { Ellipse: { size } };
      }
      const c = affine.apply(n.transform, centre);
      return {
        ...layer,
        transform: transform(c.x, c.y, angle, n.opacity),
        shape,
        ...paint(n, centre, report),
        stroke: stroke(n, report),
      };
    }
    case 'group':
    case 'frame': {
      // A group's origin is its transform's translation; children stay relative to it.
      if (n.type === 'frame') report.push(`Frame "${n.name}" inside another frame was exported as a group (no clipping yet).`);
      if (n.type === 'group' && (n.blendMode !== 'normal' || n.effects.some(e => e.visible))) {
        report.push(`Group "${n.name}": PBC applies blend modes and effects to a layer's own artwork, not to a group's children.`);
      }
      const children = doc.children(n.id).map(c => toLayer(doc, c, ctx));
      // A nested frame's background is a rect at the back.
      const centre = { x: n.width / 2, y: n.height / 2 };
      const bg = n.type === 'frame' && n.fills.length
        ? [{
          ...baseLayer(ctx.id(), `${n.name} background`),
          transform: transform(centre.x, centre.y, 0, 1),
          shape: { Rect: { size: k({ x: n.width, y: n.height }), radius: k(n.cornerRadius ?? 0) } },
          ...paint(n, centre, report),
          stroke: stroke(n, report),
        }]
        : [];
      return { ...layer, transform: transform(n.transform[4], n.transform[5], angle, n.opacity), children: [...bg, ...children] };
    }
    default:
      report.push(`"${n.name}" (${n.type}) isn't supported by the PBC export yet.`);
      return { ...layer, hidden: true };
  }
}

/** Fields every PBC node needs; the rest use PBC's defaults. */
function baseLayer(id: number, name: string) {
  return {
    id,
    name,
    transform: transform(0, 0, 0, 1),
    shape: null,
    fill: null,
    stroke: null,
    motion_blur: false,
    children: [] as unknown[],
  };
}

function transform(x: number, y: number, rotationDeg: number, opacity: number) {
  return {
    anchor: k(vec3(0, 0)),
    position: k(vec3(round(x), round(y))),
    rotation: k(round(rotationDeg)),
    scale: k(vec3(1, 1, 1)),
    opacity: k(opacity),
  };
}

const withOpacity = (c: RGBA, opacity: number): RGBA => ({ ...c, a: c.a * opacity });

/**
 * PBC layers have one fill: the top visible paint. A gradient is written as
 * PBC's `gradient`, with its flat average as the fallback `fill`. Gradient
 * points go from Nook's unit box into PBC's centred layer space.
 */
function paint(n: Node, centre: Point, report: string[]): { fill: unknown; gradient?: unknown } {
  const visible = n.fills.filter(f => f.visible);
  if (visible.length > 1) report.push(`"${n.name}" has ${visible.length} fills; only the top one was exported.`);
  const top = visible[visible.length - 1];
  if (!top) return { fill: null };
  if (top.blendMode !== 'normal') report.push(`"${n.name}": a fill's own blend mode isn't in PBC; it was drawn as Normal.`);
  const fill = k(withOpacity(paintColor(top), top.opacity));
  if (top.kind === 'solid') return { fill };
  const local = (u: Point) => ({ x: round(u.x * n.width - centre.x), y: round(u.y * n.height - centre.y) });
  return {
    fill,
    gradient: {
      kind: top.kind === 'linear' ? 'Linear' : 'Radial',
      start: k(local(top.from)),
      end: k(local(top.to)),
      stops: top.stops.map(s => ({ offset: s.offset, color: k(withOpacity(s.color, top.opacity)) })),
    },
  };
}

/** PBC has one centred, solid stroke per layer. */
function stroke(n: Node, report: string[]): unknown {
  const visible = n.strokes.filter(s => s.paint.visible && s.width > 0);
  const s = visible[visible.length - 1];
  if (!s) return null;
  if (visible.length > 1) report.push(`"${n.name}" has ${visible.length} strokes; only the top one was exported.`);
  if (s.paint.kind !== 'solid') report.push(`"${n.name}": gradient strokes aren't in PBC; it was flattened to one colour.`);
  if (s.align !== 'center') report.push(`"${n.name}": its stroke is ${s.align} in Nook but centred on the outline in PBC.`);
  return { color: k(withOpacity(paintColor(s.paint), s.paint.opacity)), width: k(s.width) };
}

const EFFECT_NAMES: Record<Effect['kind'], string> = {
  dropShadow: 'drop shadow', innerShadow: 'inner shadow', layerBlur: 'layer blur', backgroundBlur: 'background blur',
};

/**
 * Drop shadow and layer blur map onto PBC's DropShadow and GaussianBlur. PBC's
 * radius is the Gaussian sigma, which Nook draws as half the blur value.
 */
function effects(n: Node, report: string[]): unknown[] {
  return n.effects.flatMap((e): unknown[] => {
    if (e.kind === 'dropShadow') {
      if (e.spread && e.visible) report.push(`"${n.name}": drop shadow spread isn't in PBC; the shadow was exported without it.`);
      return [{
        enabled: e.visible,
        kind: { DropShadow: { color: k({ ...e.color, a: 1 }), offset_x: k(e.x), offset_y: k(e.y), radius: k(e.blur / 2), opacity: k(e.color.a) } },
      }];
    }
    if (e.kind === 'layerBlur') return [{ enabled: e.visible, kind: { GaussianBlur: { radius: k(e.radius / 2) } } }];
    if (e.visible) report.push(`"${n.name}": ${EFFECT_NAMES[e.kind]} isn't in PBC yet, so it was left out.`);
    return [];
  });
}
