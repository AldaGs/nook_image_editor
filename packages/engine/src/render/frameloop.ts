// Frame loop: draws only when something changed (saves battery on phones),
// and reports frames per second while frames are being drawn.

export class FrameLoop {
  private raf = 0;
  private dirty = true;
  private frames = 0;
  private windowStart = 0;

  constructor(private draw: () => void, private onFps: (fps: number) => void) {}

  start(): void {
    const tick = (t: number) => {
      this.raf = requestAnimationFrame(tick);
      if (!this.dirty) return;
      this.dirty = false;
      this.draw();
      this.countFrame(t);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Ask for a redraw on the next animation frame. */
  invalidate(): void {
    this.dirty = true;
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private countFrame(t: number) {
    if (t - this.windowStart > 1000) {
      // A gap longer than the window means we were idle: start a fresh count.
      if (this.windowStart && t - this.windowStart < 1500) this.onFps(Math.round((this.frames * 1000) / (t - this.windowStart)));
      this.windowStart = t;
      this.frames = 0;
    }
    this.frames++;
  }
}
