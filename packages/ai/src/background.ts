// Background removal: the picture goes in at the model's size, a foreground
// mask comes out, and the mask becomes the picture's alpha at its own size.
//
// IS-Net runs anywhere, the CPU included. BiRefNet is sharper but only runs on
// a GPU with enough room (its CPU path needs more than WebAssembly's 4 GB);
// where it can't run, IS-Net does the job instead. ONNX Runtime is bundled
// with the app and only loaded here, after the model, so nothing AI-related
// downloads while AI is off.

import { loadModel, MODELS, type ModelId } from './models.ts';
import { onAiCleared } from './switch.ts';

type Ort = typeof import('onnxruntime-web/webgpu');
type Session = import('onnxruntime-web/webgpu').InferenceSession;

/** How each model wants its input, and whether it can run without a GPU. */
const SPEC: Record<ModelId, { size: number; mean: number[]; std: number[]; gpuOnly: boolean }> = {
  isnet: { size: 1024, mean: [0.5, 0.5, 0.5], std: [1, 1, 1], gpuOnly: false },
  birefnetLite: { size: 1024, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], gpuOnly: true },
  birefnet: { size: 1024, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], gpuOnly: true },
};
/** The model that runs anywhere. */
const FALLBACK: ModelId = 'isnet';

/** BiRefNet's largest GPU kernel binds this many storage buffers; many GPUs allow only 16. */
const STORAGE_BUFFERS = 17;

type Loaded = { ort: Ort; s: Session; gpu: boolean };
const sessions = new Map<string, Promise<Loaded | null>>();
let gpuFailed = false; // a GPU run failed on this device: use the CPU from now on

/**
 * A WebGPU device with the limits BiRefNet needs, or null.
 * ponytail: the limit check is specific to BiRefNet; another model may need its own.
 */
async function gpuDevice(): Promise<unknown | null> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ limits: unknown; requestDevice(d: object): Promise<unknown> } | null> } }).gpu;
  const adapter = await gpu?.requestAdapter().catch(() => null);
  // Read as a plain map: the DOM's GPUSupportedLimits type has no string index.
  const limits = adapter?.limits as Record<string, number | undefined> | undefined;
  if (!adapter || !limits || (limits.maxStorageBuffersPerShaderStage ?? 0) < STORAGE_BUFFERS) return null;
  const want = ['maxStorageBuffersPerShaderStage', 'maxStorageBufferBindingSize', 'maxBufferSize', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup'];
  const requiredLimits = Object.fromEntries(want.filter(k => limits[k] !== undefined).map(k => [k, limits[k]!]));
  return adapter.requestDevice({ requiredLimits }).catch(() => null);
}

/** One session per model and device kind, made on first use. Null when the model can't run here. */
function session(model: ModelId, allowGpu: boolean): Promise<Loaded | null> {
  const key = `${model}|${allowGpu}`;
  let s = sessions.get(key);
  if (!s) {
    s = (async () => {
      const device = allowGpu ? await gpuDevice() : null;
      if (!device && SPEC[model].gpuOnly) return null;
      const bytes = await loadModel(MODELS[model].file); // refuses while AI is off
      const ort = await import('onnxruntime-web/webgpu');
      ort.env.logLevel = 'error'; // the runtime's optimizer warnings aren't actionable here
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      if (device) (ort.env.webgpu as { device: unknown }).device = device;
      else ort.env.wasm.proxy = true; // keep the UI responsive on the CPU path
      const sess = await ort.InferenceSession.create(bytes, { executionProviders: device ? ['webgpu', 'wasm'] : ['wasm'] });
      return { ort, s: sess, gpu: !!device };
    })().catch(e => { sessions.delete(key); throw e; });
    sessions.set(key, s);
  }
  return s;
}

/** Drop loaded sessions (AI switched off, or its data removed). */
export const unloadSessions = () => sessions.clear();
onAiCleared(unloadSessions);

/**
 * Cut the subject out of a picture: returns the picture as a PNG with the
 * background made transparent, and which model did it (the chosen one, or
 * IS-Net when the chosen one can't run on this device).
 */
export async function removeBackground(picture: Blob, model: ModelId): Promise<{ png: Blob; model: ModelId }> {
  for (const m of model === FALLBACK ? [model] : [model, FALLBACK]) {
    const loaded = await session(m, !gpuFailed);
    if (!loaded) continue; // a GPU-only model with no GPU for it
    try {
      return { png: await cutOut(picture, loaded, m), model: m };
    } catch (e) {
      if (!loaded.gpu) throw e;
      // Some GPUs can't run every kernel: stop using the GPU on this device and try again.
      gpuFailed = true;
      const cpu = await session(m, false);
      if (cpu) return { png: await cutOut(picture, cpu, m), model: m };
    }
  }
  throw new Error('no background-removal model can run on this device');
}

async function cutOut(picture: Blob, { ort, s }: Loaded, model: ModelId): Promise<Blob> {
  const { size, mean, std } = SPEC[model];
  const bmp = await createImageBitmap(picture);
  const { width, height } = bmp;

  // Input: the picture squeezed to the model's square, normalized, planar RGB.
  const small = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true })!;
  small.drawImage(bmp, 0, 0, size, size);
  const px = small.getImageData(0, 0, size, size).data;
  const n = size * size;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) input[c * n + i] = (px[i * 4 + c]! / 255 - mean[c]!) / std[c]!;
  const out = (await s.run({ [s.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, size, size]) }))[s.outputNames[0]!]!;
  const raw = out.data as Float32Array;

  // Logits or probabilities depending on the export: sigmoid only if needed,
  // then stretched to the full 0–1 range (as rembg does), so the subject is solid.
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const v = raw[i]!; if (v < lo) lo = v; if (v > hi) hi = v; }
  const sig = lo < -0.01 || hi > 1.01;
  const f = (v: number) => (sig ? 1 / (1 + Math.exp(-v)) : v);
  const a = f(lo), b = f(hi), span = b - a || 1;
  const mask = new ImageData(size, size);
  for (let i = 0; i < n; i++) mask.data[i * 4 + 3] = Math.round(((f(raw[i]!) - a) / span) * 255);

  // The mask, scaled back to the picture's size, cuts the picture (destination-in keeps where the mask is).
  const maskCanvas = new OffscreenCanvas(size, size);
  maskCanvas.getContext('2d')!.putImageData(mask, 0, 0);
  const result = new OffscreenCanvas(width, height);
  const ctx = result.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskCanvas, 0, 0, width, height);
  bmp.close();
  return result.convertToBlob({ type: 'image/png' });
}
