// Tool interface. The input router sends one-pointer events here; two-finger
// gestures go to the camera instead (and cancel whatever the tool was doing).

import type { Camera } from '../../camera/camera.ts';
import type { Point } from '../../geom/affine.ts';
import type { Editor } from '../editor.ts';

export interface PointerInfo {
  screen: Point;   // CSS px, relative to the canvas
  world: Point;
  shift: boolean;
  alt: boolean;
  touch: boolean;  // finger or pen: bigger hit areas, drag-to-pan on empty space
  time: number;
}

export interface ToolContext {
  editor: Editor;
  camera: Camera;
  /** Redraw without a document change (camera moves, overlays). */
  invalidate(): void;
}

export interface Tool {
  down(p: PointerInfo): void;
  move(p: PointerInfo): void;
  up(p: PointerInfo): void;
  /** Abort the current interaction and undo anything it changed. */
  cancel(): void;
}

/** Movement (CSS px) before a press becomes a drag. Fingers wobble more than mice. */
export const dragThreshold = (p: PointerInfo) => (p.touch ? 8 : 3);
/** Hit radius (CSS px) around handles and thin shapes. */
export const hitRadius = (p: PointerInfo) => (p.touch ? 22 : 8);
