// Keyboard shortcuts (desktop, or a keyboard attached to a tablet).
import type { Editor } from '@nook/engine';

export function attachShortcuts(editor: Editor, actions: { fit: () => void }): () => void {
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (mod && key === 'z') editor[e.shiftKey ? 'redo' : 'undo']();
    else if (mod && key === 'y') editor.redo();
    else if (mod && key === 'g') editor[e.shiftKey ? 'ungroup' : 'group']();
    else if (mod && key === 'a') editor.select(editor.doc.children(editor.pageId).map(n => n.id));
    else if (key === 'delete' || key === 'backspace') editor.deleteSelection();
    else if (key === 'escape') { editor.select([]); editor.setTool('select'); }
    else if (key === ']' && editor.selection.length === 1) editor.reorder(editor.selection[0]!, 1);
    else if (key === '[' && editor.selection.length === 1) editor.reorder(editor.selection[0]!, -1);
    else if (e.shiftKey && e.code === 'Digit1') actions.fit();
    else if (!mod && key === 'v') editor.setTool('select');
    else if (!mod && key === 'r') editor.setTool('rect');
    else if (!mod && key === 'o') editor.setTool('ellipse');
    else if (!mod && key === 'f') editor.setTool('frame');
    else if (!mod && key === 't') editor.setTool('text');
    else return;
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
