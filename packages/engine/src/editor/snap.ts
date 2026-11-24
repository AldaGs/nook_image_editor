// Snapping: pull a moving box so its edges or centre line up with another
// box's, or so it sits at an equal gap from its neighbours, and report the
// guide lines to draw.

import type { Point, Rect } from '../geom/affine.ts';

/** A guide line in world space. */
export interface Guide { a: Point; b: Point }

type Axis = 'x' | 'y';
const lo = (r: Rect, ax: Axis) => (ax === 'x' ? r.x : r.y);
const size = (r: Rect, ax: Axis) => (ax === 'x' ? r.width : r.height);
const hi = (r: Rect, ax: Axis) => lo(r, ax) + size(r, ax);
const other = (ax: Axis): Axis => (ax === 'x' ? 'y' : 'x');
const stops = (r: Rect, ax: Axis) => [lo(r, ax), lo(r, ax) + size(r, ax) / 2, hi(r, ax)];
/** A line from `a` to `b` along `ax`, at `at` on the other axis. */
const line = (ax: Axis, a: number, b: number, at: number): Guide =>
  ax === 'x' ? { a: { x: a, y: at }, b: { x: b, y: at } } : { a: { x: at, y: a }, b: { x: at, y: b } };

interface Candidate { delta: number; guides: (moved: Rect) => Guide[] }

/** Edges and centres lining up with another box. */
function alignCandidates(box: Rect, others: Rect[], ax: Axis): Candidate[] {
  const out: Candidate[] = [];
  for (const s of stops(box, ax)) {
    for (const t of new Set(others.flatMap(o => stops(o, ax)))) {
      out.push({
        delta: t - s,
        guides: moved => {
          // Everything touching the line, plus the moved box, sets its extent.
          const hit = [moved, ...others.filter(o => stops(o, ax).some(v => Math.abs(v - t) < 1e-6))];
          const o = other(ax);
          return [line(o, Math.min(...hit.map(r => lo(r, o))), Math.max(...hit.map(r => hi(r, o))), t)];
        },
      });
    }
  }
  return out;
}

/**
 * Equal gaps with neighbours in the same row (or column): centred between two
 * of them, or one gap past a pair that already has that gap.
 * ponytail: O(n²) over the boxes in the row; fine for a board's worth of layers.
 */
function spacingCandidates(box: Rect, others: Rect[], ax: Axis): Candidate[] {
  const o = other(ax);
  const row = others.filter(r => hi(r, o) > lo(box, o) && lo(r, o) < hi(box, o)).sort((a, b) => lo(a, ax) - lo(b, ax));
  const mid = (r: Rect) => lo(r, o) + size(r, o) / 2;
  const out: Candidate[] = [];
  const gapGuides = (pairs: [Rect, Rect][]) => (moved: Rect) =>
    pairs.flatMap(([a, b]) => {
      const [l, r] = lo(a, ax) < lo(b, ax) ? [a, b] : [b, a];
      return [line(ax, hi(l, ax), lo(r, ax), (Math.max(lo(l, o), lo(r, o)) + Math.min(hi(l, o), hi(r, o))) / 2 || mid(moved))];
    });
  for (let i = 0; i < row.length; i++) {
    for (let j = i + 1; j < row.length; j++) {
      const L = row[i]!, R = row[j]!;
      const gap = lo(R, ax) - hi(L, ax);
      if (gap < 0) continue;
      // Centred in the gap between L and R.
      if (gap > size(box, ax)) {
        const at = (hi(L, ax) + lo(R, ax) - size(box, ax)) / 2;
        out.push({ delta: at - lo(box, ax), guides: m => gapGuides([[L, m], [m, R]])(m) });
      }
      // Only next-door pairs set a gap to repeat.
      if (j !== i + 1) continue;
      out.push({ delta: hi(R, ax) + gap - lo(box, ax), guides: m => gapGuides([[L, R], [R, m]])(m) });
      out.push({ delta: lo(L, ax) - gap - size(box, ax) - lo(box, ax), guides: m => gapGuides([[L, R], [m, L]])(m) });
    }
  }
  return out;
}

function snapAxis(box: Rect, others: Rect[], ax: Axis, tol: number): Candidate | null {
  let best: Candidate | null = null;
  for (const c of [...alignCandidates(box, others, ax), ...spacingCandidates(box, others, ax)]) {
    if (Math.abs(c.delta) < tol && (!best || Math.abs(c.delta) < Math.abs(best.delta))) best = c;
  }
  return best;
}

/**
 * Snap `box` (already moved by the raw drag) to `others`. Returns the extra
 * offset to apply and the guides to draw.
 */
export function snapBox(box: Rect, others: Rect[], tol: number): { dx: number; dy: number; guides: Guide[] } {
  const sx = snapAxis(box, others, 'x', tol);
  const sy = snapAxis(box, others, 'y', tol);
  const moved = { ...box, x: box.x + (sx?.delta ?? 0), y: box.y + (sy?.delta ?? 0) };
  return {
    dx: sx?.delta ?? 0,
    dy: sy?.delta ?? 0,
    guides: [...(sx?.guides(moved) ?? []), ...(sy?.guides(moved) ?? [])],
  };
}

/**
 * Snap the edges a resize is dragging (`x`/`y`: which edge moves on that axis)
 * to other boxes' edges and centres. Returns the snapped box and its guides.
 */
export function snapEdges(box: Rect, moving: { x?: 'lo' | 'hi'; y?: 'lo' | 'hi' }, others: Rect[], tol: number): { box: Rect; guides: Guide[] } {
  const out = { ...box };
  const guides: Guide[] = [];
  for (const ax of ['x', 'y'] as const) {
    const side = moving[ax];
    if (!side) continue;
    const v = side === 'lo' ? lo(out, ax) : hi(out, ax);
    let best: number | null = null;
    for (const t of others.flatMap(o => stops(o, ax))) {
      if (Math.abs(t - v) < tol && (best === null || Math.abs(t - v) < Math.abs(best - v))) best = t;
    }
    if (best === null) continue;
    const d = best - v;
    if (ax === 'x') { if (side === 'lo') { out.x += d; out.width -= d; } else out.width += d; }
    else { if (side === 'lo') { out.y += d; out.height -= d; } else out.height += d; }
    const t = best;
    const hit = [out, ...others.filter(o => stops(o, ax).some(s => Math.abs(s - t) < 1e-6))];
    const o = other(ax);
    guides.push(line(o, Math.min(...hit.map(r => lo(r, o))), Math.max(...hit.map(r => hi(r, o))), t));
  }
  return { box: out, guides };
}
