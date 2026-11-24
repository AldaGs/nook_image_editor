// Node factories and frame presets.

import { translation } from '../geom/affine.ts';
import type { Node, NodeType, RGBA } from './types.ts';
import { solid } from './types.ts';

export const newId = (): string => crypto.randomUUID().slice(0, 13);

const WHITE: RGBA = { r: 1, g: 1, b: 1, a: 1 };
const SHAPE_GREY: RGBA = { r: 0.85, g: 0.85, b: 0.87, a: 1 };

/** A node with sensible defaults for its type; override anything via `props`. */
export function createNode(type: NodeType, props: Partial<Node> & { parentId: string | null; order: string }): Node {
  const base: Node = {
    id: newId(),
    type,
    name: defaultName(type),
    transform: translation(0, 0),
    width: 100,
    height: 100,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    fills: type === 'group' || type === 'page' ? [] : [solid(type === 'frame' ? WHITE : SHAPE_GREY)],
    strokes: [],
    effects: [],
    ...props,
  };
  if (type === 'rect' || type === 'frame') base.cornerRadius ??= 0;
  if (type === 'polygon') base.pointCount ??= 3;
  if (type === 'vector') base.path ??= { anchors: [], closed: false };
  if (type === 'star') { base.pointCount ??= 5; base.innerRatio ??= 0.4; }
  if (type === 'line' || type === 'vector') {
    if (!props.fills) base.fills = [];
    if (!props.strokes) base.strokes = [{ paint: solid({ r: 0, g: 0, b: 0, a: 1 }), width: 4, align: 'center' }];
  }
  if (type === 'frame') base.clipContent ??= true;
  if (type === 'text') {
    base.text ??= { content: 'Text', family: 'Inter', weight: 400, size: 48, lineHeight: null, letterSpacing: 0, align: 'left', sizing: 'autoWidth' };
    if (!props.fills) base.fills = [solid({ r: 0, g: 0, b: 0, a: 1 })];
  }
  return base;
}

const defaultName = (type: NodeType) => type[0]!.toUpperCase() + type.slice(1);

/** Social and board sizes (README "Frame presets"). */
export const FRAME_PRESETS = [
  { id: 'ig-portrait', name: 'IG post 4:5', width: 1080, height: 1350 },
  { id: 'ig-square', name: 'IG post 1:1', width: 1080, height: 1080 },
  { id: 'story', name: 'Story / Reel / TikTok', width: 1080, height: 1920 },
  { id: 'yt-thumb', name: 'YouTube thumbnail', width: 1280, height: 720 },
  { id: 'x-post', name: 'X post', width: 1600, height: 900 },
  { id: 'hd', name: 'Styleframe 1080p', width: 1920, height: 1080 },
] as const;
export type FramePreset = (typeof FRAME_PRESETS)[number];

/**
 * Where Stories, Reels and TikTok cover a 9:16 board with their own UI
 * (profile row, captions and reply bar, side buttons), as fractions of the
 * board. Approximate: each app moves these a little between versions.
 */
export const STORY_SAFE_ZONE = { top: 250 / 1920, bottom: 420 / 1920, right: 120 / 1080 } as const;

/** Is this board story-shaped (9:16)? */
export const isStoryShaped = (w: number, h: number) => h > 0 && Math.abs(w / h - 9 / 16) < 0.01;
