// The editing session: one Editor, its reactive state for Svelte, and autosave
// to the device (OPFS). The document survives reloads and works offline.

import { Editor, fromFile, starterDoc, blankDoc, toFile, type Doc, type Engine, type EditorState, type RGBA } from '@nook/engine';
import { readFile, removeEntry, writeFile } from '@nook/storage';
import { encode } from './export';
import { forgetProject, scheduleSync, sync } from './drive.svelte';

// Each project lives in docs/<id>/doc.json; projects.json lists them for the home screen.
const INDEX_PATH = 'projects.json';
const docPath = (id: string) => `docs/${id}/doc.json`;
export type Project = { id: string; name: string; updated: number };
export const thumbPath = (id: string) => `docs/${id}/thumb.png`;
const THUMB_WIDTH = 320; // px; cards show it at about 160
const SAVE_DELAY = 400; // ms after the last change

export const editor = new Editor(starterDoc());
// Dev only: poke the document from the browser console as `nook`.
// The safe-zone shading strength is a per-device preference.
const SAFE_ZONE_KEY = 'nook.safeZoneOpacity';
try { const v = parseFloat(localStorage.getItem(SAFE_ZONE_KEY) ?? ''); if (Number.isFinite(v)) editor.setSafeZoneOpacity(v); } catch { /* no storage */ }
export function setSafeZoneOpacity(v: number): void {
  editor.setSafeZoneOpacity(v);
  try { localStorage.setItem(SAFE_ZONE_KEY, String(editor.safeZoneOpacity)); } catch { /* no storage */ }
}
if (import.meta.env.DEV) (globalThis as Record<string, unknown>).nook = editor;

/** Mirrors editor.state; components read this to re-render on changes. */
export const ui = $state<{ state: EditorState; saved: boolean; loaded: boolean; error: string | null; projects: Project[]; projectId: string | null }>({
  state: editor.state,
  projects: [],
  projectId: null,
  saved: true,
  loaded: false,
  error: null,
});

let lastSaved = -1;
let timer: ReturnType<typeof setTimeout> | undefined;

editor.subscribe(s => {
  ui.state = s;
  if (!ui.loaded || s.version === lastSaved) return;
  ui.saved = false;
  clearTimeout(timer);
  timer = setTimeout(save, SAVE_DELAY);
});

async function save(): Promise<void> {
  const id = ui.projectId;
  if (!id) return;
  const version = editor.doc.version;
  try {
    await writeFile(docPath(id), JSON.stringify(toFile(editor.doc)));
    lastSaved = version;
    ui.saved = editor.doc.version === version;
    const p = ui.projects.find(p => p.id === id);
    if (p) { p.updated = Date.now(); await saveIndex(); }
  } catch (e) {
    ui.error = `Couldn't save on this device: ${e instanceof Error ? e.message : e}`;
  }
}

const saveIndex = async () => { await writeFile(INDEX_PATH, JSON.stringify(ui.projects)); scheduleSync(); };

/** Read the project list. A device from before projects keeps its one document as the first project. */
export async function loadSession(): Promise<void> {
  try {
    const index = await readFile(INDEX_PATH);
    if (index) ui.projects = JSON.parse(await index.text());
    else if (await readFile(docPath('current'))) {
      ui.projects = [{ id: 'current', name: 'My board', updated: Date.now() }];
      await saveIndex();
    }
  } catch (e) {
    ui.error = `Couldn't read your projects: ${e instanceof Error ? e.message : e}`;
  }
  ui.loaded = true;
  sync();
}

export async function openProject(id: string): Promise<void> {
  ui.loaded = false;
  try {
    const file = await readFile(docPath(id));
    editor.load(file ? fromFile(JSON.parse(await file.text())) : blankDoc());
  } catch (e) {
    ui.error = `Couldn't open the project: ${e instanceof Error ? e.message : e}`;
    ui.loaded = true;
    return;
  }
  lastSaved = editor.doc.version;
  ui.saved = true;
  ui.projectId = id;
  ui.loaded = true;
}

export async function newProject(): Promise<void> {
  const id = crypto.randomUUID();
  ui.projects.unshift({ id, name: `Project ${ui.projects.length + 1}`, updated: Date.now() });
  await saveIndex();
  await openProject(id);
}

/** Save and go back to the home screen. */
export async function closeProject(): Promise<void> {
  editor.endTextEdit();
  clearTimeout(timer);
  if (!ui.saved) await save();
  await saveThumb(ui.projectId);
  ui.projectId = null;
  scheduleSync();
}

/** A small picture of the first board for the home screen. Best effort: no thumb is fine. */
async function saveThumb(id: string | null): Promise<void> {
  const engine = canvasRef.engine;
  const board = editor.doc.children(editor.pageId).find(n => n.type === 'frame');
  if (!id || !engine || !board) return;
  try {
    const px = await engine.renderBoard(board.id, Math.min(1, THUMB_WIDTH / board.width));
    if (px) await writeFile(thumbPath(id), await encode(px, 'png'));
  } catch { /* keep the old thumb */ }
}

export async function renameProject(id: string, name: string): Promise<void> {
  const p = ui.projects.find(p => p.id === id);
  if (!p || !name.trim()) return;
  p.name = name.trim();
  await saveIndex();
}

/** `everywhere`: also remove it from Google Drive, so other devices drop it. */
export async function deleteProject(id: string, everywhere = false): Promise<void> {
  await forgetProject(id, everywhere);
  ui.projects = ui.projects.filter(p => p.id !== id);
  await saveIndex();
  try { await removeEntry(`docs/${id}`); } catch { /* already gone */ }
}

/** Replace the document (a .nook file was opened) and save it straight away. */
export async function openDocument(doc: Doc): Promise<void> {
  editor.endTextEdit();
  editor.load(doc);
  clearTimeout(timer);
  await save();
}

// Save right away when the app goes to the background (phones may kill it there).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && !ui.saved) { clearTimeout(timer); save(); }
});

// ── Eyedropper ─────────────────────────────────────────────────

/** The canvas engine once it has loaded, and its <canvas> (set by Canvas). */
export const canvasRef: { engine: Engine | null; canvas: HTMLCanvasElement | null } = { engine: null, canvas: null };
if (import.meta.env.DEV) (globalThis as Record<string, unknown>).nookCanvas = canvasRef;
export const eyedropper = $state({ active: false });

/** Wait for the next tap on the canvas and return the colour drawn there (null if cancelled). */
export async function pickFromCanvas(): Promise<RGBA | null> {
  const engine = canvasRef.engine;
  if (!engine) return null;
  eyedropper.active = true;
  try {
    return await engine.pickColor();
  } finally {
    eyedropper.active = false;
  }
}

export const cancelPick = () => canvasRef.engine?.cancelPickColor();
