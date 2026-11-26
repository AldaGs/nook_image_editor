<!-- Home: every project on this device. Tap to open, rename in place, delete. -->
<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import { readFile } from '@nook/storage';
  import { deleteProject, newProject, openProject, renameProject, thumbPath, ui } from '../lib/session.svelte';

  // Thumbnail object URLs by project id, freed when the home screen closes.
  let thumbs = $state<Record<string, string>>({});
  $effect(() => {
    const urls: string[] = [];
    for (const p of ui.projects) {
      readFile(thumbPath(p.id)).then(f => {
        if (!f) return;
        const url = URL.createObjectURL(f);
        urls.push(url);
        thumbs[p.id] = url;
      }).catch(() => {});
    }
    return () => urls.forEach(URL.revokeObjectURL);
  });

  const sorted = $derived([...ui.projects].sort((a, b) => b.updated - a.updated));
  const when = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  function remove(id: string, name: string) {
    if (confirm(`Delete "${name}"? This can't be undone.`)) deleteProject(id);
  }
</script>

<main>
  <header>
    <h1>Projects</h1>
    <button type="button" class="new" onclick={newProject}><Icon name="plus" /> New project</button>
  </header>

  {#if !ui.loaded}
    <p class="empty">Loading…</p>
  {:else if !sorted.length}
    <p class="empty">No projects yet. Start one with “New project”.</p>
  {:else}
    <ul>
      {#each sorted as p (p.id)}
        <li>
          <button type="button" class="open" aria-label={`Open ${p.name}`} onclick={() => openProject(p.id)}>
            {#if thumbs[p.id]}<img src={thumbs[p.id]} alt="" />{:else}<Icon name="frame" />{/if}
          </button>
          <div class="info">
            <input value={p.name} aria-label="Project name" onchange={e => renameProject(p.id, e.currentTarget.value)} />
            <span class="date">Edited {when(p.updated)}</span>
          </div>
          <IconButton icon="trash" label={`Delete ${p.name}`} onclick={() => remove(p.id, p.name)} />
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  main { height: 100%; overflow-y: auto; padding: calc(var(--space) * 2 + env(safe-area-inset-top)) calc(var(--space) * 2) var(--space); box-sizing: border-box; max-width: 640px; margin: 0 auto; }
  header { display: flex; align-items: center; justify-content: space-between; gap: var(--space); margin-bottom: calc(var(--space) * 2); }
  h1 { font-size: 22px; margin: 0; }
  .new { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border: none; border-radius: var(--radius); background: var(--accent); color: var(--on-accent); font-weight: 600; cursor: pointer; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space); }
  li { display: flex; align-items: center; gap: var(--space); padding: var(--space); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
  .open { flex: none; width: 96px; height: 72px; padding: 4px; overflow: hidden; display: grid; place-items: center; font-size: 20px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); cursor: pointer; }
  .open img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 2px; }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .info input { width: 100%; font-weight: 600; background: transparent; border-color: transparent; }
  .info input:focus { border-color: var(--border); background: var(--bg); }
  .date { color: var(--text-muted); font-size: 12px; padding-left: 9px; }
  .empty { color: var(--text-muted); text-align: center; margin-top: 20vh; }
</style>
