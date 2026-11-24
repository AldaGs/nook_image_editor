// Loads CanvasKit (Skia in WASM) once per page. The wasm URL comes from the app,
// so the engine stays bundler-agnostic.

import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm';

let loading: Promise<CanvasKit> | null = null;

export function loadCanvasKit(wasmUrl: string): Promise<CanvasKit> {
  loading ??= CanvasKitInit({ locateFile: () => wasmUrl }).catch(err => {
    loading = null; // allow a retry after a failed download
    throw err;
  });
  return loading;
}
