<!-- One row in the layers panel: expand arrow, type icon, name (double-tap to rename), eye, lock. -->
<script lang="ts">
  import type { Node } from '@nook/engine';
  import Icon, { type IconName } from './Icon.svelte';
  import { editor } from '../lib/session.svelte';

  let { node, depth, hasChildren, collapsed, selected, onSelect, onToggleCollapsed }: {
    node: Node;
    depth: number;
    hasChildren: boolean;
    collapsed: boolean;
    selected: boolean;
    onSelect: () => void;
    onToggleCollapsed: () => void;
  } = $props();

  const TYPE_ICON: Partial<Record<Node['type'], IconName>> = { frame: 'frame', group: 'group', rect: 'square', ellipse: 'circle' };

  let renaming = $state(false);
  let draft = $state('');

  function startRename() {
    draft = node.name;
    renaming = true;
  }

  function finishRename(keep: boolean) {
    if (keep) editor.rename(node.id, draft);
    renaming = false;
  }

  // Focus and select the text when the input appears.
  function autofocus(el: HTMLInputElement) {
    el.focus();
    el.select();
  }
</script>

<li class:selected class:hidden={!node.visible} style:--depth={depth}>
  {#if hasChildren}
    <button type="button" class="chev" aria-label={collapsed ? 'Expand' : 'Collapse'} onclick={onToggleCollapsed}>
      <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} />
    </button>
  {:else}
    <span class="chev"></span>
  {/if}
  <span class="type"><Icon name={TYPE_ICON[node.type] ?? 'square'} /></span>

  {#if renaming}
    <input
      bind:value={draft}
      use:autofocus
      aria-label="Layer name"
      onkeydown={e => { if (e.key === 'Enter') finishRename(true); if (e.key === 'Escape') finishRename(false); }}
      onblur={() => finishRename(true)}
    />
  {:else}
    <button type="button" class="name" onclick={onSelect} ondblclick={startRename}>{node.name}</button>
  {/if}

  <button type="button" class="toggle" class:on={!node.visible} aria-label={node.visible ? 'Hide' : 'Show'}
    onclick={() => editor.setProp([node.id], 'visible', !node.visible, node.visible ? 'Hide' : 'Show')}>
    <Icon name={node.visible ? 'eye' : 'eyeOff'} />
  </button>
  <button type="button" class="toggle" class:on={node.locked} aria-label={node.locked ? 'Unlock' : 'Lock'}
    onclick={() => editor.setProp([node.id], 'locked', !node.locked, node.locked ? 'Unlock' : 'Lock')}>
    <Icon name={node.locked ? 'lock' : 'lockOpen'} />
  </button>
</li>

<style>
  li {
    display: flex;
    align-items: center;
    min-height: 40px;
    padding-left: calc(4px + var(--depth) * 16px);
    padding-right: 4px;
  }
  li.selected { background: color-mix(in srgb, var(--accent) 16%, transparent); }
  li.hidden .name, li.hidden .type { opacity: 0.45; }
  button { background: none; border: none; padding: 0; }
  .chev, .type { display: inline-grid; place-items: center; width: 24px; flex: none; color: var(--text-muted); }
  .chev { height: 40px; }
  .name {
    flex: 1;
    min-width: 0;
    height: 40px;
    padding: 0 6px;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  input {
    flex: 1;
    min-width: 0;
    height: 30px;
    padding: 0 6px;
    font: inherit;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: 6px;
    user-select: text;
  }
  /* Eye and lock show faintly, and fully when they're switched on. */
  .toggle { display: inline-grid; place-items: center; width: 36px; height: 40px; color: var(--text-muted); opacity: 0.5; }
  .toggle.on, li:hover .toggle { opacity: 1; }
</style>
