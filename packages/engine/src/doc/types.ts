// Document model (README "Data model"). A document is a flat map of nodes;
// each node points at its parent and sorts among siblings by a fractional index.

import type { Affine } from '../geom/affine.ts';

export type NodeType =
  | 'page' | 'frame' | 'group' | 'rect' | 'ellipse'
  | 'polygon' | 'star' | 'line' | 'vector' | 'text' | 'image' | 'boolean' // later stages
  | 'component' | 'instance'; // reserved, not in the MVP

/** sRGB colour, 0–1 floats, straight (not premultiplied) alpha. */
export interface RGBA { r: number; g: number; b: number; a: number }

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'colorDodge' | 'colorBurn' | 'hardLight' | 'softLight' | 'difference'
  | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

/** Stage 1 paints are solid only; gradients and images arrive in stages 2–3. */
export interface SolidPaint { kind: 'solid'; color: RGBA; opacity: number; blendMode: BlendMode; visible: boolean }
export type Paint = SolidPaint;

export interface Stroke { paint: Paint; width: number; align: 'inside' | 'center' | 'outside' }

/** Filled in by stage 2 (shadows, blurs) and stage 5 (sticker outline). */
export interface Effect { kind: string; visible: boolean }

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
  motion?: MotionHints;   // PBC/AE export hints (stage 4)
}

/** Properties an op may set. id, type and parentId+order changes go through dedicated helpers. */
export type NodeProp = Exclude<keyof Node, 'id' | 'type'>;

export const solid = (color: RGBA): SolidPaint => ({ kind: 'solid', color, opacity: 1, blendMode: 'normal', visible: true });
