// Nook → PBC (.pbc) export. Each top-level frame becomes a comp; its contents
// become layers with names, hierarchy, position, rotation, size, paint, text,
// blend mode and effects intact. Groups become PBC group layers, or precomps
// (their motion role, or automatically when they carry a blend mode or
// effects, which PBC only applies to a precomp's content). A frame inside a
// frame becomes a precomp clipped to the frame by a mask.
//
// Format reference: _pbc/crates/core/src/node.rs (Project, Comp, Node,
// Transform, Shape, Gradient) and effect.rs. Values are written as
// `{ "Const": … }` (not animated yet). Anything PBC can't represent is listed
// in the report, never guessed.

import {
  affine, estimateText, localBox, paintColor,
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

interface Shared { report: string[]; measure: MeasureLines; fonts: Set<string>; comps: Record<string, unknown>; nextComp: number; fps: number; frames: number }
interface Ctx { sh: Shared; id: () => number }

/** A comp and its own id counter (ids are per comp, from 1; 0 is the root group). */
function addComp(sh: Shared, name: string, width: number, height: number, bg: RGBA, notes: string | undefined, build: (ctx: Ctx) => { root?: object; children: unknown[] }, compId = sh.nextComp++): number {
  let nextId = 1;
  const { root, children } = build({ sh, id: () => nextId++ });
  sh.comps[String(compId)] = {
    name,
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    fps: sh.fps,
    duration_frames: sh.frames,
    bg,
    root: { ...baseLayer(0, 'root'), ...noteTags(notes), ...root, children },
  };
  return compId;
}

/** Motion notes ride on the layer's tags (PBC's free-form labels; editor-only). */
const noteTags = (notes?: string) => (notes ? { tags: [`note: ${notes}`] } : {});
const CLEAR: RGBA = { r: 0, g: 0, b: 0, a: 0 };

export function exportPbc(doc: Doc, pageId: string, opts: Options = {}): PbcExport {
  const fps = opts.fps ?? 30;
  const seconds = opts.seconds ?? 5;
  const report: string[] = [];
  const fonts = new Set<string>();
  const sh: Shared = { report, measure: opts.measure ?? estimateLines, fonts, comps: {}, nextComp: 1, fps, frames: Math.round(fps * seconds) };
  const tops = doc.children(pageId);
  // Top-level boards take the first ids, so comp 1 (the one PBC opens) is the first board.
  const boards = tops.filter(n => n.type === 'frame');
  for (const top of tops) if (top.type !== 'frame') report.push(`"${top.name}" is outside any frame, so it isn't in a comp.`);
  const reserved = boards.map(() => sh.nextComp++);
  const pending: [number, Node][] = boards.map((b, i) => [reserved[i]!, b]);
  for (const [compId, top] of pending) {
    const fills = top.fills.filter(f => f.visible);
    const bg = fills.length ? withOpacity(paintColor(fills[fills.length - 1]!), fills[fills.length - 1]!.opacity) : { r: 1, g: 1, b: 1, a: 1 };
    if (Math.abs(affine.angleOf(top.transform)) > 1e-6) report.push(`Frame "${top.name}" is rotated; comps can't be, so the rotation was dropped.`);
    if (fills.length > 1 || fills.some(f => f.kind !== 'solid')) report.push(`Frame "${top.name}": a comp background is one flat colour, so its fills were flattened.`);
    if (top.strokes.some(s => s.paint.visible) || top.effects.some(e => e.visible)) report.push(`Frame "${top.name}": strokes and effects on a board itself aren't exported (a comp has neither).`);
    addComp(sh, top.name, top.width, top.height, bg, top.motion?.notes, ctx => ({ children: doc.children(top.id).map(n => toLayer(doc, n, ctx)) }), compId);
  }
  const comps = sh.comps;

  if (!boards.length) report.push('There are no frames to export.');
  if (fonts.size) report.push(`Fonts used: ${[...fonts].join(', ')}. PBC finds fonts by name, so install them on the computer that opens this file.`);
  const project = { comps: Object.fromEntries(Object.entries(comps).sort((a, b) => +a[0] - +b[0])), root: 1 };
  return { text: JSON.stringify({ project }, null, 2), report };
}

/** One Nook node as a PBC layer (recursively for groups and nested frames). */
function toLayer(doc: Doc, n: Node, ctx: Ctx): unknown {
  const { report } = ctx.sh;
  const { sx, sy } = affine.scaleOf(n.transform);
  const angle = (affine.angleOf(n.transform) * 180) / Math.PI;
  if (Math.abs(sx - 1) > 1e-3 || Math.abs(Math.abs(sy) - 1) > 1e-3) report.push(`"${n.name}" has a scaled transform; it was exported unscaled.`);

  const layer = {
    ...baseLayer(ctx.id(), n.name),
    hidden: !n.visible,
    locked: n.locked,
    blend: pascal(n.blendMode),
    effects: effects(n, report),
    ...noteTags(n.motion?.notes),
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
        ctx.sh.fonts.add(t.family);
        const maxWidth = t.sizing === 'autoWidth' ? null : n.width;
        const block = ctx.sh.measure(t, maxWidth);
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
      const role = motionRole(n);
      if (role === 'precomp') return precompLayer(doc, n, layer, angle, ctx);
      // A group's origin is its transform's translation; children stay relative to it.
      if (n.type === 'frame') report.push(`Frame "${n.name}" inside another frame was exported as a layer group, so it isn't clipped (its motion role).`);
      if (n.type === 'group' && (n.blendMode !== 'normal' || n.effects.some(e => e.visible))) {
        report.push(`Group "${n.name}": PBC applies blend modes and effects to a layer's own artwork, not to a group's children; set its motion role to Precomp to keep them.`);
      }
      const children = doc.children(n.id).map(c => toLayer(doc, c, ctx));
      return { ...layer, transform: transform(n.transform[4], n.transform[5], angle, n.opacity), children: [...frameBackground(n, ctx), ...children] };
    }
    default:
      report.push(`"${n.name}" (${n.type}) isn't supported by the PBC export yet.`);
      return { ...layer, hidden: true };
  }
}

/**
 * What a group or nested frame becomes. Explicit roles win; otherwise a nested
 * frame is a precomp (so it clips), and a group is a precomp only when it has a
 * blend mode or effects (PBC applies those to a precomp's content, not to a
 * plain group's children).
 */
export function motionRole(n: Node): 'precomp' | 'layer' {
  const r = n.motion?.role;
  if (r === 'precomp' || r === 'comp') return 'precomp';
  if (r === 'layer') return 'layer';
  if (n.type === 'frame') return 'precomp';
  return n.blendMode !== 'normal' || n.effects.some(e => e.visible) ? 'precomp' : 'layer';
}

/** A nested frame's fills and strokes as a rect at the back (frame space, from 0,0). */
function frameBackground(n: Node, ctx: Ctx): unknown[] {
  if (n.type !== 'frame' || (!n.fills.some(f => f.visible) && !n.strokes.some(s => s.paint.visible))) return [];
  const centre = { x: n.width / 2, y: n.height / 2 };
  return [{
    ...baseLayer(ctx.id(), `${n.name} background`),
    transform: transform(centre.x, centre.y, 0, 1),
    shape: { Rect: { size: k({ x: n.width, y: n.height }), radius: k(n.cornerRadius ?? 0) } },
    ...paint(n, centre, ctx.sh.report),
    stroke: stroke(n, ctx.sh.report),
  }];
}

/**
 * A group or frame as its own comp plus a layer instancing it. The comp's
 * origin is the top-left of the content (a frame's box, or a group's bounds),
 * and the precomp layer sits there. Frames are clipped by a mask, which PBC
 * draws in the layer's space, the same space the nested comp lands in.
 */
function precompLayer(doc: Doc, n: Node, layer: Record<string, unknown>, angle: number, ctx: Ctx): unknown {
  const box = n.type === 'frame' ? { x: 0, y: 0, width: n.width, height: n.height } : localBox(doc, n);
  const at = affine.apply(n.transform, { x: box.x, y: box.y });
  const compId = addComp(ctx.sh, n.name, box.width, box.height, CLEAR, undefined, inner => ({
    // Group bounds can start anywhere: shift the content so they start at 0,0.
    root: { transform: transform(-box.x, -box.y, 0, 1) },
    children: [...frameBackground(n, inner), ...doc.children(n.id).map(c => toLayer(doc, c, inner))],
  }));
  const corner = (x: number, y: number) => ({ point: k({ x, y }), in_tan: k({ x: 0, y: 0 }), out_tan: k({ x: 0, y: 0 }) });
  const mask = n.type === 'frame' && n.clipContent !== false
    ? { shape: { Vector: { path: { anchors: [corner(0, 0), corner(box.width, 0), corner(box.width, box.height), corner(0, box.height)], closed: true } } }, inverted: false }
    : null;
  if (mask && (n.cornerRadius ?? 0) > 0) ctx.sh.report.push(`Frame "${n.name}": its clip is square in PBC (rounded corners aren't in the mask).`);
  return { ...layer, transform: transform(at.x, at.y, angle, n.opacity), precomp: compId, ...(mask ? { mask } : {}) };
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
  if (top.kind === 'image') {
    // ponytail: PBC reads footage from files beside the project; Nook's export is one .pbc file for now.
    report.push(`"${n.name}": image fills aren't in the PBC export yet (Stage 4); it was drawn as a gray box.`);
    return { fill };
  }
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
  if (s.paint.kind !== 'solid') report.push(`"${n.name}": ${s.paint.kind === 'image' ? 'image' : 'gradient'} strokes aren't in PBC; it was flattened to one colour.`);
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
