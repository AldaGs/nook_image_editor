// Document model (README "Data model"). A document is a flat map of nodes;
// each node points at its parent and sorts among siblings by a fractional index.

import type { Affine } from '../geom/affine.ts';

export type NodeType =
  | 'page' | 'frame' | 'group' | 'rect' | 'ellipse'
  | 'polygon' | 'star' | 'line' | 'vector' | 'text' | 'image' | 'boolean' // later stages
  | 'component' | 'instance'; // reserved, not in the MVP

/** sRGB colour, 0–1 floats, straight (not premultiplied) alpha. */
export interface RGBA { r: number; g: number; b: number; a: number }

export const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'colorDodge', 'colorBurn', 'hardLight', 'softLight', 'difference',
  'exclusion', 'hue', 'saturation', 'color', 'luminosity',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

interface PaintBase { opacity: number; blendMode: BlendMode; visible: boolean }
export interface SolidPaint extends PaintBase { kind: 'solid'; color: RGBA }
export interface GradientStop { offset: number; color: RGBA }
/**
 * Linear: colour runs from `from` to `to`. Radial: `from` is the centre and
 * `to` lies on the outer circle. Points are in the node's unit box (0–1 on
 * each axis), so the gradient follows the node when it is resized.
 */
export interface GradientPaint extends PaintBase {
  kind: 'linear' | 'radial';
  stops: GradientStop[];   // offsets 0–1, in order
  from: { x: number; y: number };
  to: { x: number; y: number };
}
/**
 * A picture over the node's box. `fill` covers the box (cropping the picture),
 * `fit` shows all of it. `assetId` is the content hash of the image file;
 * width and height are its pixel size, so layout never waits for a decode.
 */
export interface ImagePaint extends PaintBase {
  kind: 'image';
  assetId: string;
  width: number;
  height: number;
  scaleMode: 'fill' | 'fit';
}
export type Paint = SolidPaint | GradientPaint | ImagePaint;
export const isGradient = (p: Paint): p is GradientPaint => p.kind === 'linear' || p.kind === 'radial';

export interface Stroke { paint: Paint; width: number; align: 'inside' | 'center' | 'outside' }

export interface Shadow { kind: 'dropShadow' | 'innerShadow'; visible: boolean; color: RGBA; x: number; y: number; blur: number; spread: number }
export interface Blur { kind: 'layerBlur' | 'backgroundBlur'; visible: boolean; radius: number }
/** The sticker outline (stage 5) joins this union. */
export type Effect = Shadow | Blur;

/**
 * Text content and style. `sizing` says which way the box follows the text:
 * autoWidth hugs each line (no wrapping), autoHeight keeps its width and
 * grows down as lines wrap, fixed keeps both.
 */
export interface TextProps {
  content: string;
  family: string;
  weight: number;               // 100–900
  size: number;                 // px
  lineHeight: number | null;    // px; null = the font's own
  letterSpacing: number;        // px
  align: 'left' | 'center' | 'right';
  sizing: 'autoWidth' | 'autoHeight' | 'fixed';
  /** A box behind each line (pill: round ends, highlight: square), or one speech bubble round the block. */
  background?: TextBackground;
}

export interface TextBackground {
  style: 'pill' | 'highlight' | 'bubble';
  color: RGBA;
  padding: number;
  /** Bubble tail: false hides it; at is 0–1 along the bottom edge (default: the text's alignment); size in px (default: padding, at least 12). */
  tail?: { show: boolean; at?: number; size?: number };
}

export interface MotionHints { role?: 'comp' | 'precomp' | 'layer'; notes?: string }

export interface Node {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  order: string;          // fractional index among siblings
  transform: Affine;      // local → parent space; the node's box is (0, 0, width, height)
  width: number;
  height: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  fills: Paint[];
  strokes: Stroke[];
  effects: Effect[];
  cornerRadius?: number;  // rect and frame
  clipContent?: boolean;  // frame
  text?: TextProps;       // text
  motion?: MotionHints;   // PBC/AE export hints (stage 4)
}

/** Properties an op may set. id, type and parentId+order changes go through dedicated helpers. */
export type NodeProp = Exclude<keyof Node, 'id' | 'type'>;

export const solid = (color: RGBA): SolidPaint => ({ kind: 'solid', color, opacity: 1, blendMode: 'normal', visible: true });

export const linear = (a: RGBA, b: RGBA): GradientPaint => ({
  kind: 'linear', stops: [{ offset: 0, color: a }, { offset: 1, color: b }],
  from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 }, opacity: 1, blendMode: 'normal', visible: true,
});

/** Defaults for a newly added effect, Figma-like. */
export function newEffect(kind: Effect['kind']): Effect {
  if (kind === 'layerBlur' || kind === 'backgroundBlur') return { kind, visible: true, radius: 8 };
  return { kind, visible: true, color: { r: 0, g: 0, b: 0, a: 0.25 }, x: 0, y: 4, blur: 8, spread: 0 };
}

/** One flat colour standing in for a paint (gradients: their average stop). */
export function paintColor(p: Paint): RGBA {
  if (p.kind === 'solid') return p.color;
  if (p.kind === 'image') return { r: 0.5, g: 0.5, b: 0.5, a: 1 };
  const n = p.stops.length || 1;
  const sum = p.stops.reduce((a, s) => ({ r: a.r + s.color.r, g: a.g + s.color.g, b: a.b + s.color.b, a: a.a + s.color.a }), { r: 0, g: 0, b: 0, a: 0 });
  return { r: sum.r / n, g: sum.g / n, b: sum.b / n, a: sum.a / n };
}
