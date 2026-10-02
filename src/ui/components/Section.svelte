<script lang="ts">
  import type { Snippet } from "svelte";

  let { title, children }: { title: string; children: Snippet } = $props();
</script>

<section class="section" aria-label={title}>
  <h2>{title}</h2>
  {@render children()}
</section>

<style>
  .section {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 16px 18px 18px;
  }
  h2 {
    margin: 0 0 14px;
    font-size: 1rem;
    font-weight: 700;
  }
</style>
