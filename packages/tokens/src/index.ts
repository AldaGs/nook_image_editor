// Tokens the engine needs as numbers (CSS variables can't reach the canvas).
// Keep these in sync with tokens.css.

/** sRGB 0–1 floats. */
export interface TokenColor { r: number; g: number; b: number; a: number }

const hex = (h: string): TokenColor => {
  const n = parseInt(h.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
};

export const canvasColors = {
  // Selection colour: ink in light mode; light gray in dark mode, because the
  // boards themselves are usually white and a white outline would vanish on them.
  light: { background: hex('#f4f4f5'), board: hex('#ffffff'), accent: hex('#18181b') },
  dark: { background: hex('#1c1c1f'), board: hex('#2e2e33'), accent: hex('#a1a1aa') },
} as const;
