// Origin Private File System helpers: small, async, path-based.
// Paths are "/"-separated and relative to the OPFS root, e.g. "docs/abc/doc.json".

async function dirFor(path: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) throw new Error(`invalid path: "${path}"`);
  let dir = await navigator.storage.getDirectory();
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return { dir, name };
}

export async function writeFile(path: string, data: Blob | BufferSource | string): Promise<void> {
  const { dir, name } = await dirFor(path, true);
  const handle = await dir.getFileHandle(name, { create: true });
  const w = await handle.createWritable();
  await w.write(data);
  await w.close();
}

/** Returns null when the file doesn't exist. */
export async function readFile(path: string): Promise<File | null> {
  try {
    const { dir, name } = await dirFor(path, false);
    return await (await dir.getFileHandle(name)).getFile();
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotFoundError') return null;
    throw e;
  }
}

export async function removeEntry(path: string): Promise<void> {
  const { dir, name } = await dirFor(path, false);
  await dir.removeEntry(name, { recursive: true });
}

/** Names of the files directly inside a folder; empty when the folder doesn't exist. */
export async function listDir(path: string): Promise<string[]> {
  let dir = await navigator.storage.getDirectory();
  try {
    for (const p of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(p);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotFoundError') return [];
    throw e;
  }
  const names: string[] = [];
  for await (const [name, h] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) if (h.kind === 'file') names.push(name);
  return names;
}
