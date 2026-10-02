<script lang="ts">
  import type { Snippet } from "svelte";

  /** An always-open setup section (spec: tool layout redesign). `status` is information only. */
  let { title, status = "", tone = "muted", children }: { title: string; status?: string; tone?: "ok" | "warn" | "muted"; children: Snippet } = $props();
  const id = `setup-${Math.random().toString(36).slice(2, 9)}`;
</script>

<section class="setup-section" aria-labelledby={id}>
  <header>
    <h2 {id}>{title}</h2>
    {#if status}<span class="section-status {tone}">{status}</span>{/if}
  </header>
  {@render children()}
</section>

<style>
  .setup-section {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    padding: 18px 20px 20px;
  }
  header {
    display: flex;
    gap: 12px;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  h2 {
    margin: 0;
    font-size: 1.02rem;
    font-weight: 700;
  }
  .section-status {
    font-size: 0.88rem;
    color: var(--text-muted);
    text-align: right;
  }
  .section-status.ok {
    color: var(--ok);
  }
  .section-status.warn {
    color: var(--warn);
  }
</style>
