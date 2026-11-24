// Public API of @nook/engine. The engine never imports UI code.
export { createEngine, type Engine, type EngineOptions, type FrameLabel } from './engine.ts';
export { Camera } from './camera/camera.ts';
export { Editor, estimateText, type EditorState, type ToolId, type GradientTarget, type MeasureText, type TextEdit } from './editor/editor.ts';
export { Doc } from './doc/document.ts';
export { FRAME_PRESETS, STORY_SAFE_ZONE, isStoryShaped, type FramePreset } from './doc/factory.ts';
export { toFile, fromFile, starterDoc, usedAssets, type DocFile } from './doc/serialize.ts';
export type { ImagePaint, TextProps, TextBackground, Node, NodeType, RGBA, Paint, SolidPaint, GradientPaint, GradientStop, Stroke, Effect, Shadow, Blur, BlendMode, MotionHints } from './doc/types.ts';
export { solid, linear, newEffect, paintColor, isGradient, BLEND_MODES } from './doc/types.ts';
export type { RendererTheme } from './render/renderer.ts';
export { localBox } from './editor/bounds.ts';
export * as affine from './geom/affine.ts';
export type { Affine, Point, Rect } from './geom/affine.ts';
export { toHex, parseHex, rgbToHsv, hsvToRgb, documentColors, type HSVA } from './doc/color.ts';
