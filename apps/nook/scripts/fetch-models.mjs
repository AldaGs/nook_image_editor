// Download AI model files into public/models so Nook serves them itself (AI runs
// on the device; nothing is fetched from a third party at runtime).
// Run: pnpm fetch-models            (all three)
//      pnpm fetch-models isnet      (just the one that runs everywhere)
// Models are not committed (public/models is gitignored). A missing model never
// fails a build: Settings shows it as "not on this server". --strict makes it an error.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const MODELS = [
  {
    // Runs on any device, the CPU included.
    id: 'isnet',
    file: 'isnet-general-use.onnx',
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
    sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
    license: 'https://raw.githubusercontent.com/xuebinqin/DIS/main/LICENSE.md',
  },
  {
    id: 'lite',
    file: 'birefnet_lite_fp16.onnx',
    url: 'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model_fp16.onnx',
    sha256: 'd39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402',
    license: 'https://raw.githubusercontent.com/ZhengPeng7/BiRefNet/main/LICENSE',
  },
  {
    id: 'full',
    file: 'birefnet_fp16.onnx',
    url: 'https://huggingface.co/onnx-community/BiRefNet-ONNX/resolve/main/onnx/model_fp16.onnx',
    sha256: '3654c741eb80bd926ada8fed1713b506ccf8d30eb1f6487e87eb9f234f33df09',
    license: 'https://raw.githubusercontent.com/ZhengPeng7/BiRefNet/main/LICENSE',
  },
];

const STRICT = process.argv.includes('--strict');
const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
const dir = new URL('../public/models/', import.meta.url);
await mkdir(dir, { recursive: true });
const hash = b => createHash('sha256').update(b).digest('hex');

for (const m of MODELS.filter(m => !only.length || only.includes(m.id))) {
  const dest = new URL(m.file, dir);
  const have = await readFile(dest).catch(() => null);
  if (have && hash(have) === m.sha256) { console.log(`✓ ${m.file} (present)`); continue; }
  console.log(`↓ ${m.file}`);
  const res = await fetch(m.url).catch(e => ({ ok: false, status: e.message }));
  if (!res.ok) {
    const msg = `${m.file}: HTTP ${res.status} from ${m.url}`;
    if (STRICT) throw new Error(msg);
    console.warn(`⚠ skipped ${msg}. Settings will show it as not on this server.`);
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (hash(buf) !== m.sha256) throw new Error(`${m.file}: sha256 mismatch (${hash(buf)})`);
  await writeFile(dest, buf);
  await writeFile(new URL(m.file.replace(/\.onnx$/, '.LICENSE.txt'), dir), await fetch(m.license).then(r => r.text()));
  console.log(`✓ ${m.file} ${(buf.length / 1048576).toFixed(1)} MB`);
}
