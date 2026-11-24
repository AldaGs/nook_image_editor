// The editing session: one Editor, its reactive state for Svelte, and autosave
// to the device (OPFS). The document survives reloads and works offline.

import { Editor, fromFile, starterDoc, toFile, type EditorState } from '@nook/engine';
import { readFile, writeFile } from '@nook/storage';

const DOC_PATH = 'docs/current/doc.json';
const SAVE_DELAY = 400; // ms after the last change

export const editor = new Editor(starterDoc());
// Dev only: poke the document from the browser console as `nook`.
if (import.meta.env.DEV) (globalThis as Record<string, unknown>).nook = editor;

/** Mirrors editor.state; components read this to re-render on changes. */
export const ui = $state<{ state: EditorState; saved: boolean; loaded: boolean; error: string | null }>({
  state: editor.state,
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
  const version = editor.doc.version;
  try {
    await writeFile(DOC_PATH, JSON.stringify(toFile(editor.doc)));
    lastSaved = version;
    ui.saved = editor.doc.version === version;
  } catch (e) {
    ui.error = `Couldn't save on this device: ${e instanceof Error ? e.message : e}`;
  }
}

/** Open the autosaved document, or keep the starter one if there is none. */
export async function loadSession(): Promise<void> {
  try {
    const file = await readFile(DOC_PATH);
    if (file) editor.load(fromFile(JSON.parse(await file.text())));
  } catch (e) {
    ui.error = `Couldn't open the saved document: ${e instanceof Error ? e.message : e}`;
  }
  lastSaved = editor.doc.version;
  ui.loaded = true;
}

// Save right away when the app goes to the background (phones may kill it there).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && !ui.saved) { clearTimeout(timer); save(); }
});
