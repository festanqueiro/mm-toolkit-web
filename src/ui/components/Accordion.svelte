<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title,
    open,
    disabled = false,
    grow = false,
    ontoggle,
    children,
  }: { title: string; open: boolean; disabled?: boolean; grow?: boolean; ontoggle: () => void; children: Snippet } = $props();

  const id = `acc-${Math.random().toString(36).slice(2, 9)}`;
</script>

<!-- Desktop `Accordion`: a collapsed section shrinks to its header; parents enforce one-open-per-column. -->
<section class="accordion" class:open class:grow={grow && open} aria-label={title}>
  <h2>
    <button type="button" aria-expanded={open} aria-controls={id} {disabled} onclick={ontoggle}>
      <span class="chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
      {title}
    </button>
  </h2>
  <div {id} class="body" hidden={!open} inert={disabled}>
    {@render children()}
  </div>
</section>

<style>
  .accordion {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .grow {
    flex: 1;
  }
  h2 {
    margin: 0;
    font-size: 1rem;
  }
  h2 button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-weight: 700;
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius);
  }
  h2 button:disabled {
    color: var(--text-muted);
    cursor: default;
  }
  .chevron {
    width: 1em;
    color: var(--text-muted);
  }
  .body {
    padding: 0 16px 16px;
    flex: 1;
    min-height: 0;
  }
  .body[inert] {
    opacity: 0.55;
  }
</style>
