<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title,
    open = $bindable(false),
    children,
    actions,
    onclose,
  }: { title: string; open: boolean; children: Snippet; actions: Snippet; onclose?: () => void } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  const titleId = `modal-${Math.random().toString(36).slice(2, 9)}`;

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<!-- Native <dialog>: focus trap, Esc to cancel and the top layer come for free. -->
<dialog
  bind:this={dialog}
  aria-labelledby={titleId}
  onclose={() => {
    open = false;
    onclose?.();
  }}
>
  <h2 id={titleId}>{title}</h2>
  {@render children()}
  <div class="actions">{@render actions()}</div>
</dialog>

<style>
  dialog {
    width: min(440px, calc(100vw - 32px));
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    padding: 20px 22px;
    box-shadow: var(--shadow-md);
  }
  dialog::backdrop {
    background: rgba(8, 10, 16, 0.55);
    backdrop-filter: blur(2px);
  }
  h2 {
    margin: 0 0 12px;
    font-size: 1.1rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
</style>
