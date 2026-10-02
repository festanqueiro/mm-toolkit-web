<script lang="ts">
  import type { Snippet } from "svelte";

  /** A titled block in the output rail; a size container so forms inside can stack. */
  let { title, children }: { title: string; children: Snippet } = $props();
  const id = `rail-${Math.random().toString(36).slice(2, 9)}`;
</script>

<section class="rail-block" aria-labelledby={id}>
  <h2 {id}>{title}</h2>
  {@render children()}
</section>

<style>
  .rail-block {
    container: rail / inline-size;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    padding: 14px 16px 16px;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 0.95rem;
    font-weight: 700;
  }
</style>
