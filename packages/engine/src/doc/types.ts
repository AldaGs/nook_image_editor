// Document types. Stage 0 only needs a rect to draw; the full node model
// (README "Data model") lands in stage 1.

/** sRGB colour, 0–1 floats, straight (not premultiplied) alpha. */
export interface RGBA { r: number; g: number; b: number; a: number }

export interface RectNode {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  fill: RGBA;
}
