<script lang="ts">
  import Icon from "./Icon.svelte";
  import { routeFromHash, routes } from "./routes";
  import About from "./tabs/About.svelte";
  import Placeholder from "./tabs/Placeholder.svelte";
  import Settings from "./tabs/Settings.svelte";
  import { initApp } from "./state.svelte";

  initApp();

  let current = $state(routeFromHash(location.hash));

  $effect(() => {
    const onHashChange = () => (current = routeFromHash(location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  });
</script>

<div class="shell">
  <nav class="tabs" aria-label="Tools">
    {#each routes as route (route.path)}
      <a
        class="tab"
        href="#/{route.path}"
        aria-current={route.path === current.path ? "page" : undefined}
      >
        <Icon name={route.icon} />
        <span>{route.label}</span>
      </a>
    {/each}
  </nav>

  <main class="page">
    {#if current.path === "about"}
      <About />
    {:else if current.path === "settings"}
      <Settings />
    {:else}
      <Placeholder route={current} />
    {/if}
  </main>
</div>

<style>
  .shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .tabs {
    display: flex;
    gap: 4px;
    padding: 8px var(--gutter) 0;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 14px;
    border-radius: var(--radius) var(--radius) 0 0;
    color: var(--text-muted);
    text-decoration: none;
    white-space: nowrap;
    border-bottom: 2px solid transparent;
  }
  .tab:hover {
    color: var(--text);
    background: var(--surface-alt);
  }
  .tab[aria-current="page"] {
    color: var(--text);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }
  .page {
    flex: 1;
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px var(--gutter);
  }
  @media (min-width: 900px) {
    .page {
      padding: 24px 28px;
    }
  }
</style>
