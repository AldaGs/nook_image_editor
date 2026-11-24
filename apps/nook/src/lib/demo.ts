// Stage 0 placeholder scene: three IG-post boards (1080×1350) with a shape on each.
// Replaced by the real document in stage 1.
import type { RectNode, RGBA } from '@nook/engine';

const POST = { width: 1080, height: 1350 };
const GAP = 120;

export function demoScene(board: RGBA, accent: RGBA): RectNode[] {
  return [0, 1, 2].flatMap(i => {
    const x = i * (POST.width + GAP);
    return [
      { id: `frame-${i}`, name: `Frame ${i + 1}`, x, y: 0, ...POST, radius: 0, fill: board },
      { id: `shape-${i}`, name: `Shape ${i + 1}`, x: x + 240, y: 375, width: 600, height: 600, radius: 48 * (i + 1), fill: accent },
    ];
  });
}
