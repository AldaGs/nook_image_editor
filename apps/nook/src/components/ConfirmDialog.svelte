<!-- The app's confirmation dialog (see lib/confirm). A native modal <dialog> (focus trap, Esc),
     only in the page while a question is open, so it can never be left open and empty. -->
<script lang="ts">
  import { answer, dialog } from '../lib/confirm.svelte';

  const modal = (el: HTMLDialogElement) => { el.showModal(); };
</script>

{#if dialog.current}
  {@const d = dialog.current}
  <dialog use:modal oncancel={e => { e.preventDefault(); answer(null); }} onclick={e => { if (e.target === e.currentTarget) answer(null); }}>
    <div class="box">
      <h2>{d.title}</h2>
      {#if d.message}<p>{d.message}</p>{/if}
      <div class="buttons">
        {#each d.choices as c (c.label)}
          <button type="button" class:danger={c.danger} class:primary={!c.danger} onclick={() => answer(c.value)}>{c.label}</button>
        {/each}
        <!-- Cancel takes focus so Enter never deletes by accident. -->
        <!-- svelte-ignore a11y_autofocus -->
        <button type="button" onclick={() => answer(null)} autofocus>Cancel</button>
      </div>
    </div>
  </dialog>
{/if}

<style>
  dialog {
    width: min(360px, calc(100vw - 32px));
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 12px 40px rgb(0 0 0 / 0.3);
  }
  .box { padding: calc(var(--space) * 2); }
  dialog::backdrop { background: rgb(0 0 0 / 0.45); }
  h2 { margin: 0 0 6px; font-size: 17px; }
  p { margin: 0; color: var(--text-muted); font-size: 14px; line-height: 1.45; white-space: pre-line; }
  .buttons { display: flex; flex-direction: column; gap: 8px; margin-top: calc(var(--space) * 2); }
  button { min-height: 44px; border-radius: 12px; font-weight: 600; font-size: 15px; cursor: pointer; border: 1px solid var(--border); background: none; color: var(--text); }
  .primary { border: none; background: var(--accent); color: var(--on-accent); }
  .danger { border: none; background: #e5484d; color: #fff; }
</style>
