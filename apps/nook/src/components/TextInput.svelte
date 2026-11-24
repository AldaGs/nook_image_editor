<!-- The hidden <textarea> that takes keyboard input while a text layer is being typed
     into. The canvas draws the text, caret and selection; this only receives keys,
     autocorrect and IME, so the phone keyboard behaves like it does anywhere else.
     It sits at the caret so IME pop-ups appear in the right place. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Engine } from '@nook/engine';
  import { editor } from '../lib/session.svelte';

  let { engine, canvas }: { engine: Engine | null; canvas: HTMLCanvasElement } = $props();

  let ta: HTMLTextAreaElement;
  let at = $state({ x: -1000, y: -1000 });

  /** Keep the caret clear of the on-screen keyboard (the visual viewport is what's left above it). */
  function reveal() {
    if (!engine || !editor.textEdit) return;
    const r = canvas.getBoundingClientRect();
    const vv = window.visualViewport;
    const top = Math.max(r.top, vv?.offsetTop ?? 0);
    const bottom = Math.min(r.bottom, vv ? vv.offsetTop + vv.height : window.innerHeight);
    const p = engine.revealCaret({ x: 0, y: top - r.top, width: r.width, height: Math.max(0, bottom - top) });
    if (p) at = { x: r.left + p.x, y: r.top + p.y };
  }

  const typed = () => { editor.typeText(ta.value, ta.selectionStart, ta.selectionEnd); reveal(); };
  const moved = () => {
    if (document.activeElement !== ta || !editor.textEdit) return;
    editor.setTextSelection(ta.selectionStart, ta.selectionEnd);
    reveal();
  };
  // Focus leaving for good (keyboard dismissed, a button elsewhere) ends typing.
  const blurred = () => setTimeout(() => { if (document.activeElement !== ta) editor.endTextEdit(); });

  onMount(() => {
    // Called inside the tap that starts typing, so iOS opens the keyboard.
    editor.onTextEdit = (e, content) => {
      if (ta.value !== content) ta.value = content;
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(e.start, e.end);
      reveal();
    };
    // While typing, presses on the canvas place the caret; don't let them take focus away.
    const keepFocus = (e: MouseEvent) => { if (editor.textEdit) e.preventDefault(); };
    canvas.addEventListener('mousedown', keepFocus);
    document.addEventListener('selectionchange', moved);
    window.visualViewport?.addEventListener('resize', reveal);
    window.visualViewport?.addEventListener('scroll', reveal);
    return () => {
      editor.onTextEdit = null;
      canvas.removeEventListener('mousedown', keepFocus);
      document.removeEventListener('selectionchange', moved);
      window.visualViewport?.removeEventListener('resize', reveal);
      window.visualViewport?.removeEventListener('scroll', reveal);
    };
  });
</script>

<textarea
  bind:this={ta}
  aria-label="Text"
  style:left="{at.x}px"
  style:top="{at.y}px"
  oninput={typed}
  onblur={blurred}
  onkeydown={e => { if (e.key === 'Escape') ta.blur(); }}
></textarea>

<style>
  textarea {
    position: fixed;
    width: 2px;
    height: 1.2em;
    padding: 0;
    border: 0;
    margin: 0;
    opacity: 0;
    resize: none;
    overflow: hidden;
    font-size: 16px; /* below 16px iOS zooms the page on focus */
    caret-color: transparent;
    pointer-events: none;
    white-space: pre;
  }
</style>
