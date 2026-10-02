<script lang="ts">
  import type { Snippet } from "svelte";

  /** A file input row that also accepts drag & drop: icon/thumbnail · title + body · actions. */
  let {
    title,
    filled = false,
    disabled = false,
    ondropped,
    icon,
    children,
    actions,
  }: {
    title: string;
    filled?: boolean;
    disabled?: boolean;
    ondropped: (transfer: DataTransfer) => void;
    icon: Snippet;
    children: Snippet;
    actions: Snippet;
  } = $props();

  const id = `zone-${Math.random().toString(36).slice(2, 9)}`;
  let dragging = $state(false);

  function dragOver(event: DragEvent) {
    if (disabled || !event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    dragging = true;
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    if (event.dataTransfer && !disabled) ondropped(event.dataTransfer);
  }
</script>

<div class="zone" class:filled class:dragging role="group" aria-labelledby={id} ondragover={dragOver} ondragleave={() => (dragging = false)} ondrop={drop}>
  <span class="zone-icon">{@render icon()}</span>
  <div class="zone-body">
    <span class="zone-title" {id}>{title}</span>
    {@render children()}
  </div>
  <div class="zone-actions">{@render actions()}</div>
</div>

<style>
  .zone {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas: "icon body" "actions actions";
    gap: 10px 14px;
    align-items: center;
    padding: 14px;
    border: 1.5px dashed var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface-sunken);
    transition:
      border-color 0.15s,
      background-color 0.15s;
  }
  @media (min-width: 560px) {
    .zone {
      grid-template-columns: auto minmax(0, 1fr) auto;
      grid-template-areas: "icon body actions";
    }
  }
  .zone.filled {
    border-style: solid;
    border-color: var(--border);
    background: var(--surface);
  }
  .zone.dragging {
    border-color: var(--accent);
    border-style: dashed;
    background: var(--accent-soft);
  }
  .zone-icon {
    grid-area: icon;
    display: grid;
  }
  /* Default icon tile; a thumbnail snippet brings its own box. */
  .zone-icon > :global(.tile) {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: 12px;
    color: var(--link);
    background: color-mix(in srgb, var(--brand-blue) 18%, transparent);
  }
  .filled .zone-icon > :global(.tile) {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .zone-body {
    grid-area: body;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .zone-title {
    font-weight: 700;
  }
  .zone-body :global(.zone-file) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .zone-body :global(.zone-hint) {
    color: var(--text-muted);
    font-size: 0.92rem;
  }
  .zone-body :global(.status) {
    margin-top: 2px;
  }
  .zone-actions {
    grid-area: actions;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
</style>
