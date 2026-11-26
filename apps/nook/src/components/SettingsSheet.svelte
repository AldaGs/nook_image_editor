<!-- Settings: the AI switch (off by default), which background-removal model to
     use, and what AI has downloaded to this device (with a way to remove it). -->
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    aiEnabled, backgroundModel, modelInstalled, MODELS, removeAiData, setAiEnabled, setBackgroundModel, storedAiData,
    type ModelId,
  } from '@nook/ai';
  import Sheet from './Sheet.svelte';
  import { editor, setSafeZoneOpacity } from '../lib/session.svelte';
  import { clearDrive, connectDrive, disconnectDrive, drive, sync } from '../lib/drive.svelte';

  let { onClose }: { onClose: () => void } = $props();

  let on = $state(aiEnabled());
  let safeOpacity = $state(editor.safeZoneOpacity);
  let model = $state<ModelId>(backgroundModel());
  let installed = $state<Partial<Record<ModelId, boolean>>>({});
  let stored = $state<{ path: string; bytes: number }[]>([]);

  const ids = Object.keys(MODELS) as ModelId[];
  const mb = (b: number) => `${(b / 1048576).toFixed(0)} MB`;
  const downloaded = (id: ModelId) => stored.find(s => s.path.endsWith(MODELS[id].file));

  async function refresh() { stored = await storedAiData(); }

  onMount(() => {
    refresh();
    for (const id of ids) modelInstalled(MODELS[id].file).then(ok => (installed = { ...installed, [id]: ok }));
  });

  function toggle(v: boolean) { setAiEnabled(v); on = v; }
  function pick(id: ModelId) { setBackgroundModel(id); model = id; }
  function clearSync() {
    if (confirm("Delete everything Nook has saved in your Google Drive and stop syncing here? Projects on your devices stay.")) clearDrive();
  }
  async function remove(path?: string) { await removeAiData(path); await refresh(); }
</script>

<Sheet title="Settings" {onClose}>
  <section>
    <h3>Canvas</h3>
    <div class="row">
      <span class="name">Safe zone opacity</span>
      <input type="range" min="0.05" max="0.9" step="0.01" aria-label="Safe zone opacity" value={safeOpacity}
        style:--fill="{((safeOpacity - 0.05) / 0.85) * 100}%"
        oninput={e => { safeOpacity = +e.currentTarget.value; setSafeZoneOpacity(safeOpacity); if (!editor.safeZones) editor.setSafeZones(true); }} />
      <span class="muted pct">{Math.round(safeOpacity * 100)}%</span>
    </div>
  </section>

  {#if drive.available}
    <section>
      <h3>Google Drive sync</h3>
      {#if drive.connected}
        <div class="row">
          <span class="name">{drive.syncing ? 'Syncing…' : drive.error ? `Sync: ${drive.error}` : 'On. Projects sync across your devices.'}</span>
          <button type="button" class="link" onclick={sync}>Sync now</button>
          <button type="button" class="link" onclick={disconnectDrive}>Turn off</button>
        </div>
      {:else}
        <small>Keeps your projects in a private Nook folder in your Google Drive, so they show up on all your devices.</small>
        <button type="button" class="secondary" onclick={connectDrive}>Sync with Google Drive</button>
      {/if}
      <button type="button" class="secondary" onclick={clearSync}>Clear Nook data from Google Drive</button>
      <p class="muted"><a href="/privacy.html" target="_blank">Privacy policy</a> · <a href="/terms.html" target="_blank">Terms</a></p>
    </section>
  {/if}

  <section>
    <h3>AI</h3>
    <label class="switch">
      <span>
        <strong>Use AI on this device</strong>
        <small>Off by default. Models come from this app, download only when a tool first needs them, and run on your device: your pictures never leave it.</small>
      </span>
      <input type="checkbox" role="switch" checked={on} onchange={e => toggle(e.currentTarget.checked)} />
    </label>
  </section>

  <section>
    <h3>Background removal</h3>
    {#each ids as id (id)}
      {@const m = MODELS[id]}
      <label class="choice">
        <input type="radio" name="bg-model" checked={model === id} onchange={() => pick(id)} />
        <span>
          <strong>{m.name}</strong> <span class="muted">{m.mb} MB</span>
          <small>{m.about}. {downloaded(id) ? 'Downloaded.' : installed[id] === false ? 'Not on this server yet.' : 'Downloads on first use.'}</small>
        </span>
      </label>
    {/each}
    <p class="muted">IS-Net: {MODELS.isnet.license}. BiRefNet: {MODELS.birefnet.license}.</p>
  </section>

  <section>
    <h3>Downloaded AI data</h3>
    {#if stored.length}
      {#each stored as s (s.path)}
        <div class="row">
          <span class="name">{s.path.split('/').pop()}</span>
          <span class="muted">{mb(s.bytes)}</span>
          <button type="button" class="link" onclick={() => remove(s.path)}>Remove</button>
        </div>
      {/each}
      <button type="button" class="secondary" onclick={() => remove()}>Remove all ({mb(stored.reduce((a, s) => a + s.bytes, 0))})</button>
    {:else}
      <p class="muted">Nothing downloaded.</p>
    {/if}
  </section>
</Sheet>

<style>
  section { padding: 4px var(--space) var(--space); border-top: 1px solid var(--border); }
  section:first-of-type { border-top: none; }
  h3 { margin: 8px 0 4px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  small { display: block; color: var(--text-muted); font-size: 12px; line-height: 1.35; margin-top: 2px; }
  .switch, .choice { display: flex; align-items: flex-start; gap: 12px; padding: 8px 0; }
  .switch span { flex: 1; }
  .choice input { flex: none; margin: 3px 0 0; accent-color: var(--accent); width: 18px; height: 18px; }
  /* An iOS-style switch from a plain checkbox. */
  input[role='switch'] {
    appearance: none;
    flex: none;
    width: 51px;
    height: 31px;
    border-radius: 16px;
    background: var(--track);
    position: relative;
    transition: background 0.2s;
  }
  input[role='switch']::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 27px;
    height: 27px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 3px 8px rgb(0 0 0 / 0.15), 0 3px 1px rgb(0 0 0 / 0.06);
    transition: transform 0.2s;
  }
  input[role='switch']:checked { background: var(--accent); }
  input[role='switch']:checked::after { transform: translateX(20px); }
  .row { display: flex; align-items: center; gap: 8px; min-height: var(--touch-target); }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row input[type='range'] { flex: 1.4; min-width: 0; }
  .pct { width: 3em; text-align: right; }
  .muted { color: var(--text-muted); font-size: 12px; }
  p.muted { margin: 4px 0; }
  .link { background: none; border: none; color: var(--text); text-decoration: underline; min-height: var(--touch-target); }
  .secondary { width: 100%; min-height: 44px; margin-top: 8px; border: 1px solid var(--border); border-radius: 12px; background: none; font-weight: 600; }
</style>
