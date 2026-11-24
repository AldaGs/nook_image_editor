// Camera: maps world space (the infinite canvas) to screen space (CSS pixels).
// screen = (world - origin) * zoom. Pure data + math, so it is unit-testable.

export interface Point { x: number; y: number }

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 256;

export class Camera {
  /** World point shown at the top-left of the viewport. */
  x = 0;
  y = 0;
  zoom = 1;

  screenToWorld(p: Point): Point {
    return { x: p.x / this.zoom + this.x, y: p.y / this.zoom + this.y };
  }

  worldToScreen(p: Point): Point {
    return { x: (p.x - this.x) * this.zoom, y: (p.y - this.y) * this.zoom };
  }

  /** Move the view by a screen-space delta (finger or wheel movement). */
  panBy(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
  }

  /** Zoom by `factor`, keeping the world point under `screen` fixed (zoom to cursor/pinch centre). */
  zoomAt(screen: Point, factor: number): void {
    const before = this.screenToWorld(screen);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const after = this.screenToWorld(screen);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  /** Centre a world rectangle in a viewport of the given size, with padding in screen px. */
  fit(rect: { x: number; y: number; width: number; height: number }, view: { width: number; height: number }, pad = 32): void {
    const zx = (view.width - pad * 2) / rect.width;
    const zy = (view.height - pad * 2) / rect.height;
    this.zoom = clamp(Math.min(zx, zy), MIN_ZOOM, MAX_ZOOM);
    this.x = rect.x + rect.width / 2 - view.width / 2 / this.zoom;
    this.y = rect.y + rect.height / 2 - view.height / 2 / this.zoom;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
