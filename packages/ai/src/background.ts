// Background removal with BiRefNet: the picture goes in at 1024×1024, a
// foreground mask comes out, and the mask becomes the picture's alpha at its
// own size. ONNX Runtime is bundled with the app and only loaded here, after
// the model (so nothing AI-related downloads while AI is off).

import { loadModel, MODELS, type ModelId } from './models.ts';
import { onAiCleared } from './switch.ts';

type Ort = typeof import('onnxruntime-web/webgpu');
type Session = import('onnxruntime-web/webgpu').InferenceSession;

const SIZE = 1024;
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
const sessions = new Map<string, Promise<{ ort: Ort; s: Session; gpu: boolean }>>();
let gpuFailed = false; // a GPU run failed on this device: use the CPU from now on

/** BiRefNet's largest GPU kernel binds this many storage buffers; WebGPU's default device allows 8 (often 16). */
const STORAGE_BUFFERS = 17;

type GpuAdapter = { limits: Record<string, number>; requestDevice(d: { requiredLimits: Record<string, number> }): Promise<unknown> };

/**
 * A WebGPU device with the limits BiRefNet needs, or null to use the CPU.
 * ponytail: the limit check is specific to BiRefNet; a second model may need its own.
 */
async function gpuDevice(): Promise<unknown | null> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<GpuAdapter | null> } }).gpu;
  const adapter = await gpu?.requestAdapter().catch(() => null);
  // Read as a plain map: the DOM's GPUSupportedLimits type has no string index.
  const limits = adapter?.limits as unknown as Record<string, number | undefined> | undefined;
  if (!adapter || !limits || (limits.maxStorageBuffersPerShaderStage ?? 0) < STORAGE_BUFFERS) return null;
  const want = ['maxStorageBuffersPerShaderStage', 'maxStorageBufferBindingSize', 'maxBufferSize', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup'];
  const requiredLimits = Object.fromEntries(want.filter(k => limits[k] !== undefined).map(k => [k, limits[k]!]));
  return adapter.requestDevice({ requiredLimits }).catch(() => null);
}

/** One inference session per model, made on first use: WebGPU where it can run the model, else the CPU in ORT's worker. */
function session(model: ModelId, allowGpu = true) {
  const file = MODELS[model].file;
  const key = `${file}|${allowGpu}`;
  let s = sessions.get(key);
  if (!s) {
    s = (async () => {
      const bytes = await loadModel(file); // refuses while AI is off
      const ort = await import('onnxruntime-web/webgpu');
      const device = allowGpu ? await gpuDevice() : null;
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

/** float32 → IEEE half floats, for models that take fp16 input. */
function toHalf(src: Float32Array): Uint16Array {
  const out = new Uint16Array(src.length), f = new Float32Array(1), u = new Uint32Array(f.buffer);
  for (let i = 0; i < src.length; i++) {
    f[0] = src[i]!;
    const x = u[0]!, sign = (x >>> 16) & 0x8000, exp = ((x >>> 23) & 0xff) - 112, man = x & 0x7fffff;
    out[i] = exp <= 0 ? sign : exp >= 31 ? sign | 0x7c00 : sign | (exp << 10) | (man >>> 13);
  }
  return out;
}
function fromHalf(h: number): number {
  const e = (h >>> 10) & 0x1f, m = h & 0x3ff, s = h & 0x8000 ? -1 : 1;
  return e === 0 ? s * 2 ** -14 * (m / 1024) : e === 31 ? (m ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + m / 1024);
}

/**
 * Cut the subject out of a picture: returns the same picture as a PNG with
 * the background made transparent.
 */
export async function removeBackground(picture: Blob, model: ModelId): Promise<Blob> {
  try {
    return await cutOut(picture, await session(model, !gpuFailed));
  } catch (e) {
    const tried = await session(model, !gpuFailed).catch(() => null);
    if (!tried?.gpu) throw e;
    // Some GPUs can't run every kernel: do it on the CPU instead, and keep doing so.
    gpuFailed = true;
    return cutOut(picture, await session(model, false));
  }
}

async function cutOut(picture: Blob, { ort, s }: { ort: Ort; s: Session }): Promise<Blob> {
  const bmp = await createImageBitmap(picture);
  const { width, height } = bmp;

  // Input: the picture squeezed to 1024², ImageNet-normalized, planar RGB.
  const small = new OffscreenCanvas(SIZE, SIZE).getContext('2d', { willReadFrequently: true })!;
  small.drawImage(bmp, 0, 0, SIZE, SIZE);
  const px = small.getImageData(0, 0, SIZE, SIZE).data;
  const input = new Float32Array(3 * SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < 3; c++) input[c * SIZE * SIZE + i] = (px[i * 4 + c]! / 255 - MEAN[c]!) / STD[c]!;
  }
  const meta = (s as Session & { inputMetadata?: { type?: string }[] }).inputMetadata?.[0];
  const half = meta?.type === 'float16';
  const tensor = half
    ? new ort.Tensor('float16', toHalf(input), [1, 3, SIZE, SIZE])
    : new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]);
  const out = (await s.run({ [s.inputNames[0]!]: tensor }))[s.outputNames[s.outputNames.length - 1]!]!;
  const raw = out.data as Float32Array | Uint16Array;
  const value = out.type === 'float16' ? (i: number) => fromHalf(raw[i]!) : (i: number) => raw[i]!;

  // Logits or probabilities, depending on the export: sigmoid only if needed.
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < SIZE * SIZE; i += 97) { const v = value(i); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const prob = lo < -0.01 || hi > 1.01 ? (v: number) => 1 / (1 + Math.exp(-v)) : (v: number) => v;
  const mask = new ImageData(SIZE, SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) mask.data[i * 4 + 3] = Math.round(prob(value(i)) * 255);

  // The mask, scaled back to the picture's size, cuts the picture (destination-in keeps where the mask is).
  const maskCanvas = new OffscreenCanvas(SIZE, SIZE);
  maskCanvas.getContext('2d')!.putImageData(mask, 0, 0);
  const result = new OffscreenCanvas(width, height);
  const ctx = result.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskCanvas, 0, 0, width, height);
  bmp.close();
  return result.convertToBlob({ type: 'image/png' });
}
