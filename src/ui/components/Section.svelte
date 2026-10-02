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
    box-shadow: var(--shadow-sm);
    padding: 18px 20px 20px;
  }
  h2 {
    margin: 0 0 16px;
    font-size: 1.02rem;
    font-weight: 700;
  }
</style>
