// Nook → PBC (.pbc) export. Each top-level frame becomes a comp; its contents
// become layers with names, hierarchy, position, rotation, size, colour and
// opacity intact. Groups become PBC group layers.
//
// Format reference: painbychoice/crates/core/src/node.rs (Project, Comp, Node,
// Transform, Shape). Values are written as `{ "Const": … }` (not animated yet).
// Anything PBC can't represent yet is listed in the report, never guessed.

import { affine, type Doc, type Node, type RGBA } from '@nook/engine';

export interface PbcExport {
  /** Text of the .pbc file. */
  text: string;
  /** Human-readable notes about what was dropped or changed. */
  report: string[];
}

interface Options {
  fps?: number;
  /** Comp length in seconds. */
  seconds?: number;
}

const k = <T>(v: T) => ({ Const: v });
const vec3 = (x: number, y: number, z = 0) => ({ x, y, z });

export function exportPbc(doc: Doc, pageId: string, opts: Options = {}): PbcExport {
  const fps = opts.fps ?? 30;
  const seconds = opts.seconds ?? 5;
  const report: string[] = [];
  const comps: Record<string, unknown> = {};
  let nextComp = 1;

  for (const top of doc.children(pageId)) {
    if (top.type !== 'frame') {
      report.push(`"${top.name}" is outside any frame, so it isn't in a comp.`);
      continue;
    }
    // Ids are per comp, from 1 (0 is the comp's root group).
    let nextId = 1;
    const layer = (n: Node): unknown => toLayer(doc, n, () => nextId++, report);
    const bg = firstSolid(top, report) ?? { r: 1, g: 1, b: 1, a: 1 };
    if (Math.abs(affine.angleOf(top.transform)) > 1e-6) report.push(`Frame "${top.name}" is rotated; comps can't be, so the rotation was dropped.`);

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
        children: doc.children(top.id).map(layer),
      },
    };
  }

  if (nextComp === 1) report.push('There are no frames to export.');
  const project = { comps, root: 1 };
  return { text: JSON.stringify({ project }, null, 2), report };
}

/** One Nook node as a PBC layer (recursively for groups and nested frames). */
function toLayer(doc: Doc, n: Node, id: () => number, report: string[]): unknown {
  const { sx, sy } = affine.scaleOf(n.transform);
  const angle = (affine.angleOf(n.transform) * 180) / Math.PI;
  if (Math.abs(sx - 1) > 1e-6 || Math.abs(Math.abs(sy) - 1) > 1e-6) report.push(`"${n.name}" has a scaled transform; it was exported unscaled.`);
  if (n.blendMode !== 'normal') report.push(`"${n.name}": layer blend modes come in a later export stage (kept as Normal).`);
  if (n.strokes.length) report.push(`"${n.name}": strokes come in a later export stage.`);
  if (n.effects.length) report.push(`"${n.name}": effects come in a later export stage.`);

  const layer = { ...baseLayer(id(), n.name), hidden: !n.visible, locked: n.locked };
  const opacity = n.opacity;

  switch (n.type) {
    case 'rect':
    case 'ellipse': {
      // PBC shapes are centred on their position: use the box centre in parent space.
      const c = affine.apply(n.transform, { x: n.width / 2, y: n.height / 2 });
      const size = k({ x: n.width, y: n.height });
      return {
        ...layer,
        transform: transform(c.x, c.y, angle, opacity),
        shape: n.type === 'rect' ? { Rect: { size, radius: k(n.cornerRadius ?? 0) } } : { Ellipse: { size } },
        fill: k(firstSolid(n, report) ?? { r: 0, g: 0, b: 0, a: 0 }),
      };
    }
    case 'group':
    case 'frame': {
      // A group's origin is its transform's translation; children stay relative to it.
      if (n.type === 'frame') report.push(`Frame "${n.name}" inside another frame was exported as a group (no clipping yet).`);
      const children = doc.children(n.id).map(c => toLayer(doc, c, id, report));
      // A nested frame's background is a rect at the back.
      const bg = n.type === 'frame' && n.fills.length
        ? [{ ...baseLayer(id(), `${n.name} background`), transform: transform(n.width / 2, n.height / 2, 0, 1), shape: { Rect: { size: k({ x: n.width, y: n.height }), radius: k(n.cornerRadius ?? 0) } }, fill: k(firstSolid(n, report)), children: [] }]
        : [];
      return { ...layer, transform: transform(n.transform[4], n.transform[5], angle, opacity), children: [...bg, ...children] };
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

/** PBC layers have one fill: take the top visible solid, note any others. */
function firstSolid(n: Node, report: string[]): RGBA | null {
  const visible = n.fills.filter(f => f.visible);
  if (visible.length > 1) report.push(`"${n.name}" has ${visible.length} fills; only the top one was exported.`);
  const top = visible[visible.length - 1];
  return top ? { ...top.color, a: top.color.a * top.opacity } : null;
}

const round = (v: number) => Math.round(v * 1000) / 1000;
