<script lang="ts">
  import type { Route } from "../routes";

  let { route }: { route: Route } = $props();
</script>

<h1>{route.label}</h1>
{#if route.subtitle}
  <p class="subtitle">{route.subtitle}</p>
{/if}
<p class="muted">Coming soon. See the roadmap in <code>docs/specs/14-roadmap.md</code>.</p>

<style>
  h1 {
    margin: 0 0 6px;
    font-size: 1.6rem;
  }
  .subtitle {
    margin: 0 0 18px;
  }
  .muted {
    color: var(--text-muted);
  }
</style>
