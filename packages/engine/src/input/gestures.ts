// Viewport gestures: turns pointer and wheel events into camera moves.
// Touch: one finger pans (until tools exist), two fingers pan + pinch-zoom.
// Desktop: wheel/trackpad scroll pans, Ctrl/⌘+wheel or trackpad pinch zooms.

import type { Camera, Point } from '../camera/camera.ts';

export function attachGestures(el: HTMLElement, camera: Camera, onChange: () => void): () => void {
  const pointers = new Map<number, Point>();
  let last: { centre: Point; dist: number } | null = null;

  /** Position relative to the element, in CSS px. */
  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** Centre and spread of the active pointers (spread is 0 for one pointer). */
  const summary = () => {
    const ps = [...pointers.values()];
    const centre = { x: avg(ps.map(p => p.x)), y: avg(ps.map(p => p.y)) };
    const dist = ps.length > 1 ? Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y) : 0;
    return { centre, dist };
  };

  const down = (e: PointerEvent) => {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    last = summary(); // restart so adding a finger doesn't jump
  };

  const move = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId) || !last) return;
    pointers.set(e.pointerId, local(e));
    const now = summary();
    camera.panBy(now.centre.x - last.centre.x, now.centre.y - last.centre.y);
    if (last.dist > 0 && now.dist > 0) camera.zoomAt(now.centre, now.dist / last.dist);
    last = now;
    onChange();
  };

  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    last = pointers.size ? summary() : null;
  };

  const wheel = (e: WheelEvent) => {
    e.preventDefault(); // stop the page from scrolling or browser-zooming
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl+wheel with small deltas.
      camera.zoomAt(local(e), Math.exp(-e.deltaY * 0.01));
    } else {
      camera.panBy(-e.deltaX, -e.deltaY);
    }
    onChange();
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });

  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('wheel', wheel);
  };
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
