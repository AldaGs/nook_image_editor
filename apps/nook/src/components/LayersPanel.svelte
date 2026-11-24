<!-- Layers panel: the page's layer tree, front-most at the top (like Figma).
     Tap to select, double-tap a name to rename, eye/lock to hide or lock.
     Reorder and group from the action bar. -->
<script lang="ts">
  import type { Node } from '@nook/engine';
  import IconButton from './IconButton.svelte';
  import LayerRow from './LayerRow.svelte';
  import { editor, ui } from '../lib/session.svelte';

  let { onClose }: { onClose: () => void } = $props();

  /** Collapsed containers (frames and groups are open by default). */
  let collapsed = $state(new Set<string>());

  interface Row { node: Node; depth: number; hasChildren: boolean }

  // Rebuild the rows whenever the document changes.
  const rows = $derived.by(() => {
    ui.state.version;
    const out: Row[] = [];
    const walk = (parentId: string, depth: number) => {
      // Reverse: the top of the list is the front of the canvas.
      for (const node of [...editor.doc.children(parentId)].reverse()) {
        const hasChildren = editor.doc.children(node.id).length > 0;
        out.push({ node, depth, hasChildren });
        if (hasChildren && !collapsed.has(node.id)) walk(node.id, depth + 1);
      }
    };
    walk(editor.pageId, 0);
    return out;
  });

  function toggleCollapsed(id: string) {
    const next = new Set(collapsed);
    if (!next.delete(id)) next.add(id);
    collapsed = next;
  }

  function pick(id: string) {
    if (ui.state.multiSelect) editor.toggleSelected(id);
    else editor.select([id]);
  }
</script>

<aside aria-label="Layers">
  <header>
    <h2>Layers</h2>
    <IconButton icon="x" label="Close layers" onclick={onClose} />
  </header>
  <ul>
    {#each rows as r (r.node.id)}
      <LayerRow
        node={r.node}
        depth={r.depth}
        hasChildren={r.hasChildren}
        collapsed={collapsed.has(r.node.id)}
        selected={ui.state.selection.includes(r.node.id)}
        onSelect={() => pick(r.node.id)}
        onToggleCollapsed={() => toggleCollapsed(r.node.id)}
      />
    {/each}
  </ul>
</aside>

<style>
  aside {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    width: min(320px, 85vw);
    padding-left: env(safe-area-inset-left);
    background: var(--surface);
    border-right: 1px solid var(--border);
    box-shadow: 4px 0 16px rgb(0 0 0 / 0.08);
  }
  header { display: flex; align-items: center; justify-content: space-between; padding: 0 4px 0 calc(var(--space) * 2); border-bottom: 1px solid var(--border); }
  h2 { font-size: 13px; margin: 0; }
  ul { flex: 1; overflow: auto; list-style: none; margin: 0; padding: 4px 0; }
</style>
