// Google Drive sync. Files go to the app's hidden Drive folder (appDataFolder,
// scope drive.appdata): only Nook can see them, and Nook can't see anything else.
// Each Drive file is named by its device path (projects.json, docs/<id>/doc.json, assets/<hash>).
//
// One sync() pass: merge the project lists by id (newest `updated` wins), then move
// each project's files in whichever direction is newer, then copy over missing pictures.
// The project open in the editor is never overwritten; it catches up once closed.
// ponytail: whole-file "newest wins"; two devices editing the same project offline lose one side.

import { listDir, readFile, removeEntry, writeFile } from '@nook/storage';
import { ui, type Project } from './session.svelte';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const INDEX = 'projects.json';
const DELETED = 'deleted.json'; // ids removed from Drive, so other devices drop them too
const PREFS_KEY = 'nook.drive';
const SYNC_DELAY = 3000; // ms after the last save

type Prefs = { connected: boolean; ignored: string[] }; // ignored: removed on this device only
type Remote = { id: string; name: string };

function readPrefs(): Prefs {
  try { return { connected: false, ignored: [], ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }; } catch { return { connected: false, ignored: [] }; }
}
const prefs = readPrefs();
const storePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* no storage */ } };

export const drive = $state<{ available: boolean; connected: boolean; syncing: boolean; lastSync: number | null; error: string | null }>({
  available: !!CLIENT_ID,
  connected: !!CLIENT_ID && prefs.connected,
  syncing: false,
  lastSync: null,
  error: null,
});

// ── Sign-in (Google Identity Services, token in memory only) ───

type TokenResponse = { access_token?: string; expires_in?: number; error?: string };
type TokenClient = { requestAccessToken(o?: { prompt?: string }): void };
declare const google: { accounts: { oauth2: {
  initTokenClient(c: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type: string }) => void }): TokenClient;
  revoke(token: string, done?: () => void): void;
} } };

let token: { value: string; expires: number } | null = null;
let gis: Promise<void> | null = null;

function loadGis(): Promise<void> {
  return gis ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => resolve();
    s.onerror = () => { gis = null; reject(new Error("couldn't reach Google")); };
    document.head.append(s);
  });
}

/** An access token. `interactive` may show Google's consent popup (needs a tap to have started it). */
async function getToken(interactive: boolean): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID!,
      scope: SCOPE,
      callback: r => {
        if (!r.access_token) return reject(new Error(r.error ?? 'sign-in failed'));
        token = { value: r.access_token, expires: Date.now() + (r.expires_in ?? 3600) * 1000 };
        resolve(r.access_token);
      },
      error_callback: e => reject(new Error(e.type === 'popup_closed' ? 'sign-in was closed' : 'sign-in needed')),
    });
    client.requestAccessToken({ prompt: interactive ? (prefs.connected ? '' : 'consent') : 'none' });
  });
}

// ── Drive REST ─────────────────────────────────────────────────

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const t = await getToken(false);
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${t}` } });
  if (res.status === 401) token = null;
  if (!res.ok && res.status !== 404) throw new Error(`Google Drive said ${res.status}`);
  return res;
}

async function listRemote(): Promise<Map<string, Remote>> {
  const out = new Map<string, Remote>();
  let page = '';
  do {
    const q = new URLSearchParams({ spaces: 'appDataFolder', fields: 'nextPageToken,files(id,name)', pageSize: '1000' });
    if (page) q.set('pageToken', page);
    const body = await (await call(`${API}?${q}`)).json() as { files: Remote[]; nextPageToken?: string };
    for (const f of body.files) out.set(f.name, f);
    page = body.nextPageToken ?? '';
  } while (page);
  return out;
}

async function download(f: Remote): Promise<Blob> {
  return (await call(`${API}/${f.id}?alt=media`)).blob();
}

/** Create or replace the Drive file for a device path. */
async function upload(remote: Map<string, Remote>, path: string, data: Blob): Promise<void> {
  const existing = remote.get(path);
  if (existing) {
    await call(`${UPLOAD}/${existing.id}?uploadType=media`, { method: 'PATCH', body: data });
    return;
  }
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name: path, parents: ['appDataFolder'] })], { type: 'application/json' }));
  form.append('file', data);
  const made = await (await call(`${UPLOAD}?uploadType=multipart&fields=id,name`, { method: 'POST', body: form })).json() as Remote;
  remote.set(path, made);
}

async function removeRemote(remote: Map<string, Remote>, path: string): Promise<void> {
  const f = remote.get(path);
  if (!f) return;
  await call(`${API}/${f.id}`, { method: 'DELETE' });
  remote.delete(path);
}

const json = (v: unknown) => new Blob([JSON.stringify(v)], { type: 'application/json' });
const docFiles = (id: string) => [`docs/${id}/doc.json`, `docs/${id}/thumb.png`];

// ── Sync ───────────────────────────────────────────────────────

let running: Promise<void> | null = null;
let again = false;

/** One full pass. Safe to call any time; overlapping calls run one after another. */
export function sync(): Promise<void> {
  if (!drive.connected) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    drive.syncing = true;
    try {
      do { again = false; await pass(); } while (again);
      drive.error = null;
      drive.lastSync = Date.now();
    } catch (e) {
      drive.error = e instanceof Error ? e.message : String(e);
    } finally {
      drive.syncing = false;
      running = null;
    }
  })();
  return running;
}

async function pass(): Promise<void> {
  const remote = await listRemote();
  const remoteIndex: Project[] = remote.has(INDEX) ? JSON.parse(await (await download(remote.get(INDEX)!)).text()) : [];
  const deleted: string[] = remote.has(DELETED) ? JSON.parse(await (await download(remote.get(DELETED)!)).text()) : [];
  const skip = new Set([...deleted, ...prefs.ignored]);

  // Projects deleted from Drive on another device go here too (unless open right now).
  for (const p of ui.projects.filter(p => deleted.includes(p.id) && p.id !== ui.projectId)) {
    try { await removeEntry(`docs/${p.id}`); } catch { /* already gone */ }
  }

  // Merge the lists: union by id, the newer entry wins.
  const local = new Map(ui.projects.filter(p => !deleted.includes(p.id) || p.id === ui.projectId).map(p => [p.id, p]));
  const theirs = new Map(remoteIndex.filter(p => !skip.has(p.id)).map(p => [p.id, p]));
  const merged = new Map(local);
  for (const [id, r] of theirs) {
    const l = local.get(id);
    if (!l || (r.updated > l.updated && id !== ui.projectId)) merged.set(id, { ...r });
  }

  // Move each project's files the newer way.
  for (const [id, p] of merged) {
    if (prefs.ignored.includes(id)) continue;
    const r = theirs.get(id), l = local.get(id);
    const pull = r && (!l || r.updated > l.updated) && id !== ui.projectId;
    const push = l && (!r || l.updated > r.updated || !remote.has(`docs/${id}/doc.json`));
    for (const path of docFiles(id)) {
      if (pull && remote.has(path)) await writeFile(path, await download(remote.get(path)!));
      else if (push) { const f = await readFile(path); if (f) await upload(remote, path, f); }
    }
  }

  // Pictures never change (named by content hash): copy whatever either side is missing.
  const mine = new Set(await listDir('assets'));
  for (const name of mine) if (!remote.has(`assets/${name}`)) await upload(remote, `assets/${name}`, (await readFile(`assets/${name}`))!);
  for (const [path, f] of remote) if (path.startsWith('assets/') && !mine.has(path.slice(7))) await writeFile(path, await download(f));

  // Keep the list order (newest first) and save both copies when they changed.
  const list = [...merged.values()];
  const same = (a: Project[], b: Project[]) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(list, ui.projects)) { ui.projects = list; await writeFile(INDEX, JSON.stringify(list)); }
  const forDrive = list.filter(p => !prefs.ignored.includes(p.id));
  // Keep entries other devices have that this one ignores.
  for (const r of remoteIndex) if (prefs.ignored.includes(r.id) && !deleted.includes(r.id)) forDrive.push(r);
  if (!same(forDrive, remoteIndex)) await upload(remote, INDEX, json(forDrive));
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Sync a little after the last save, so typing doesn't upload every keystroke. */
export function scheduleSync(): void {
  if (!drive.connected) return;
  clearTimeout(timer);
  timer = setTimeout(sync, SYNC_DELAY);
}

// ── Settings actions ───────────────────────────────────────────

/** Sign in (call from a tap) and run the first sync. */
export async function connectDrive(): Promise<void> {
  drive.error = null;
  try {
    await getToken(true);
  } catch (e) {
    drive.error = e instanceof Error ? e.message : String(e);
    return;
  }
  prefs.connected = drive.connected = true;
  storePrefs();
  await sync();
}

/** Sign in again after Google needs it (call from a tap). */
export async function reconnectDrive(): Promise<void> {
  token = null;
  await connectDrive();
}

/** Stop syncing on this device. Drive keeps its copy. */
export function disconnectDrive(): void {
  if (token) google.accounts.oauth2.revoke(token.value);
  token = null;
  prefs.connected = drive.connected = false;
  storePrefs();
}

/**
 * A project was deleted on this device. With `everywhere`, its Drive copy goes too and
 * other devices drop it on their next sync; otherwise only this device stops syncing it.
 */
export async function forgetProject(id: string, everywhere: boolean): Promise<void> {
  if (!drive.connected) return;
  if (!everywhere) {
    prefs.ignored.push(id);
    storePrefs();
    return;
  }
  try {
    await running;
    const remote = await listRemote();
    for (const path of docFiles(id)) await removeRemote(remote, path);
    const deleted: string[] = remote.has(DELETED) ? JSON.parse(await (await download(remote.get(DELETED)!)).text()) : [];
    if (!deleted.includes(id)) await upload(remote, DELETED, json([...deleted, id]));
    const index: Project[] = remote.has(INDEX) ? JSON.parse(await (await download(remote.get(INDEX)!)).text()) : [];
    await upload(remote, INDEX, json(index.filter(p => p.id !== id)));
  } catch (e) {
    drive.error = `Couldn't remove it from Google Drive: ${e instanceof Error ? e.message : e}`;
  }
}

/** Delete everything Nook keeps in Drive and stop syncing here. Projects on devices stay. */
export async function clearDrive(): Promise<void> {
  try {
    await running;
    await getToken(true); // works from Settings even when sync is off here
    const remote = await listRemote();
    for (const path of [...remote.keys()]) await removeRemote(remote, path);
    prefs.ignored = [];
    disconnectDrive();
    drive.lastSync = null;
    drive.error = null;
  } catch (e) {
    drive.error = `Couldn't clear Google Drive: ${e instanceof Error ? e.message : e}`;
  }
}

// Dev only: inspect the Drive folder from the browser console as `nookDrive`.
if (import.meta.env.DEV) (globalThis as Record<string, unknown>).nookDrive = { listRemote, sync, drive, read: async (name: string) => { const f = (await listRemote()).get(name); return f ? (await download(f)).text() : null; } };

// Catch up whenever the app comes back to the front.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') sync();
});
