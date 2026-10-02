<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "../Icon.svelte";

  let {
    title,
    open,
    disabled = false,
    grow = false,
    summary = "",
    ontoggle,
    children,
  }: {
    title: string;
    open: boolean;
    disabled?: boolean;
    grow?: boolean;
    /** Short state shown in the header while collapsed (e.g. "3 enabled"). */
    summary?: string;
    ontoggle: () => void;
    children: Snippet;
  } = $props();

  const id = `acc-${Math.random().toString(36).slice(2, 9)}`;
</script>

<!-- Desktop `Accordion`: a collapsed section shrinks to its header; parents enforce one-open-per-column. -->
<section class="accordion" class:open class:grow={grow && open} class:disabled aria-label={title}>
  <h2>
    <button type="button" aria-expanded={open} aria-controls={id} {disabled} onclick={ontoggle}>
      <span class="title">{title}</span>
      {#if summary && !open}<span class="summary">{summary}</span>{/if}
      <span class="chevron" aria-hidden="true"><Icon name="expand_more" size={20} /></span>
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
    box-shadow: var(--shadow-sm);
    display: flex;
    flex-direction: column;
    min-height: 0;
    transition: border-color 0.15s;
  }
  .accordion.open {
    border-color: var(--border-strong);
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
    gap: 10px;
    padding: 14px 16px;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-weight: 700;
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius);
  }
  h2 button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--surface-alt) 60%, transparent);
  }
  h2 button:disabled {
    color: var(--text-muted);
    cursor: default;
  }
  .title {
    flex: 1;
  }
  .summary {
    color: var(--text-muted);
    font-weight: 500;
    font-size: 0.88rem;
  }
  .chevron {
    display: inline-flex;
    color: var(--text-muted);
    transition: transform 0.2s;
  }
  .open .chevron {
    transform: rotate(180deg);
  }
  .body {
    padding: 2px 16px 18px;
    flex: 1;
    min-height: 0;
  }
  .disabled .body {
    opacity: 0.55;
  }
</style>
