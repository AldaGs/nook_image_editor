// Input router. One finger, a pen or a mouse goes to the active tool. A second
// finger cancels the tool and turns the gesture into pan + pinch. The wheel
// pans (Ctrl/⌘ or a trackpad pinch zooms); middle-drag or Space-drag pans.

import type { Camera, Point } from '../camera/camera.ts';
import type { PointerInfo, Tool } from '../editor/tools/tool.ts';

export function attachInput(el: HTMLElement, camera: Camera, tool: () => Tool, invalidate: () => void): () => void {
  const touches = new Map<number, Point>();
  let toolPointer: number | null = null;   // the pointer the tool is following
  let pinch: { centre: Point; dist: number } | null = null;
  let pan: { id: number; last: Point } | null = null; // middle button or Space
  let space = false;

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const info = (e: PointerEvent): PointerInfo => {
    const screen = local(e);
    return { screen, world: camera.screenToWorld(screen), shift: e.shiftKey, alt: e.altKey, touch: e.pointerType !== 'mouse', time: e.timeStamp };
  };

  /** Centre and finger spread of the active touches. */
  const pinchState = () => {
    const ps = [...touches.values()];
    const centre = { x: avg(ps.map(p => p.x)), y: avg(ps.map(p => p.y)) };
    const dist = ps.length > 1 ? Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y) : 0;
    return { centre, dist };
  };

  // Mouse cursor: the pan hand, else whatever the tool says for this spot.
  const setCursor = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    el.style.cursor = pan ? 'grabbing' : space ? 'grab' : tool().cursor?.(info(e)) ?? '';
  };

  const down = (e: PointerEvent) => {
    el.setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch') touches.set(e.pointerId, local(e));

    if (e.button === 1 || (space && e.pointerType === 'mouse')) {
      pan = { id: e.pointerId, last: local(e) };
      setCursor(e);
      e.preventDefault();
      return;
    }
    if (touches.size >= 2) {
      // Second finger: the camera takes over and the tool's edit is undone.
      if (toolPointer !== null) tool().cancel();
      toolPointer = null;
      pinch = pinchState();
      return;
    }
    if (toolPointer === null && e.button === 0) {
      toolPointer = e.pointerId;
      tool().down(info(e));
    }
    setCursor(e);
  };

  const move = (e: PointerEvent) => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) touches.set(e.pointerId, local(e));
    if (pan && e.pointerId === pan.id) {
      const p = local(e);
      camera.panBy(p.x - pan.last.x, p.y - pan.last.y);
      pan.last = p;
      invalidate();
    } else if (pinch && touches.size >= 2) {
      const now = pinchState();
      camera.panBy(now.centre.x - pinch.centre.x, now.centre.y - pinch.centre.y);
      if (pinch.dist > 0 && now.dist > 0) camera.zoomAt(now.centre, now.dist / pinch.dist);
      pinch = now;
      invalidate();
    } else if (e.pointerId === toolPointer) {
      tool().move(info(e));
    }
    setCursor(e);
  };

  const up = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (pan?.id === e.pointerId) pan = null;
    if (e.pointerId === toolPointer) {
      toolPointer = null;
      if (e.type === 'pointercancel') tool().cancel();
      else tool().up(info(e));
    }
    // Lifting one of two fingers ends the pinch; the other finger idles until lifted.
    pinch = touches.size >= 2 ? pinchState() : null;
    setCursor(e);
  };

  const wheel = (e: WheelEvent) => {
    e.preventDefault(); // no page scroll or browser zoom
    if (e.ctrlKey || e.metaKey) camera.zoomAt(local(e), Math.exp(-e.deltaY * 0.01));
    else camera.panBy(-e.deltaX, -e.deltaY);
    invalidate();
  };

  // Space-drag pans with a mouse, as in Figma. Ignored while typing.
  const key = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || isTyping(e.target)) return;
    space = e.type === 'keydown';
    el.style.cursor = space ? 'grab' : '';
    e.preventDefault();
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('keydown', key);
  window.addEventListener('keyup', key);

  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('wheel', wheel);
    window.removeEventListener('keydown', key);
    window.removeEventListener('keyup', key);
  };
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
