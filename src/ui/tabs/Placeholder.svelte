<script lang="ts">
  import PageHeader from "../components/PageHeader.svelte";
  import type { Route } from "../routes";

  let { route }: { route: Route } = $props();
</script>

<PageHeader title={route.label} subtitle={route.subtitle} icon={route.icon} />

<div class="soon">
  <span class="pill">Coming soon</span>
  <p>
    {route.label} is next on the roadmap. Meanwhile, the
    <a href="https://github.com/festanqueiro/mm-toolkit">desktop app</a> has it today.
  </p>
  <a class="btn" href="#/video-creator">Open Video Creator</a>
</div>

<style>
  .soon {
    display: grid;
    justify-items: start;
    gap: 12px;
    max-width: 560px;
    padding: 24px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .soon p {
    margin: 0;
    color: var(--text-muted);
  }
  .pill {
    padding: 3px 10px;
    border: 1px solid var(--accent);
    border-radius: 999px;
    color: var(--accent);
    font-size: 0.8rem;
    font-weight: 650;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
  }
</style>
