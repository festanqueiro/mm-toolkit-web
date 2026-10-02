<script lang="ts">
  import logo from "../../assets/mm-toolkit-logo-128.png";
  import Icon from "./Icon.svelte";
  import { routeFromHash, routes } from "./routes";
  import About from "./tabs/About.svelte";
  import History from "./tabs/History.svelte";
  import MediaConverter from "./tabs/converter/MediaConverter.svelte";
  import MediaCutter from "./tabs/cutter/MediaCutter.svelte";
  import Placeholder from "./tabs/Placeholder.svelte";
  import Settings from "./tabs/Settings.svelte";
  import VideoCreator from "./tabs/video-creator/VideoCreator.svelte";
  import { historyTabLabel } from "../engine/history";
  import { historyUi } from "./history.svelte";
  import { initApp } from "./state.svelte";

  initApp();

  const version = __APP_VERSION__;
  let current = $state(routeFromHash(location.hash));

  $effect(() => {
    const onHashChange = () => (current = routeFromHash(location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  });

  $effect(() => {
    document.title = `${current.label} · MM Toolkit`;
  });
</script>

<!-- Moves focus rather than navigating: "#main" would be read as a route. -->
<a
  class="skip"
  href="#main"
  onclick={(e) => {
    e.preventDefault();
    document.getElementById("main")?.focus();
  }}>Skip to content</a
>

<div class="shell">
  <header class="header">
    <div class="header-inner">
      <a class="brand" href="#/video-creator" aria-label="MM Toolkit home">
        <img src={logo} alt="" width="32" height="32" />
        <span class="wordmark">MM Toolkit</span>
      </a>
      <nav class="tabs" aria-label="Tools">
        {#each routes as route (route.path)}
          {@const unread = route.path === "history" && historyUi.unread > 0}
          <a class="tab" href="#/{route.path}" aria-current={route.path === current.path ? "page" : undefined}>
            <Icon name={unread ? "notifications" : route.icon} size={18} />
            <span>{route.path === "history" ? historyTabLabel(historyUi.unread) : route.label}</span>
          </a>
        {/each}
      </nav>
      <span class="privacy" title="Files are processed in this browser and never uploaded.">
        <Icon name="lock" size={14} />
        On-device
      </span>
    </div>
  </header>

  <main class="page" id="main" tabindex="-1">
    {#if current.path === "about"}
      <About />
    {:else if current.path === "video-creator"}
      <VideoCreator />
    {:else if current.path === "cutter"}
      <MediaCutter />
    {:else if current.path === "converter"}
      <MediaConverter />
    {:else if current.path === "history"}
      <History />
    {:else if current.path === "settings"}
      <Settings />
    {:else}
      <Placeholder route={current} />
    {/if}
  </main>

  <footer class="site-footer">
    <span>Everything runs in your browser. No files are uploaded.</span>
    <span class="dot" aria-hidden="true">·</span>
    <a href="#/about">v{version}</a>
    <span class="dot" aria-hidden="true">·</span>
    <a href="https://github.com/festanqueiro/mm-toolkit-web">GitHub</a>
  </footer>
</div>

<style>
  .skip {
    position: absolute;
    left: 8px;
    top: -40px;
    z-index: 100;
    padding: 6px 12px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: var(--shadow-md);
  }
  .skip:focus {
    top: 8px;
  }
  .shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .header {
    position: sticky;
    top: 0;
    z-index: 20;
    background: var(--header-bg);
    backdrop-filter: saturate(1.4) blur(12px);
    -webkit-backdrop-filter: saturate(1.4) blur(12px);
    border-bottom: 1px solid var(--border);
  }
  .header-inner {
    max-width: 1240px;
    margin: 0 auto;
    padding: 0 var(--gutter);
    display: flex;
    align-items: center;
    gap: 18px;
    min-height: 60px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--text);
    text-decoration: none;
    flex: none;
  }
  .brand img {
    display: block;
    border-radius: 50%;
  }
  .wordmark {
    font-size: 1.05rem;
    font-weight: 750;
    letter-spacing: -0.02em;
  }
  .tabs {
    display: flex;
    gap: 2px;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 7px 12px;
    border-radius: 999px;
    color: var(--text-muted);
    text-decoration: none;
    white-space: nowrap;
    font-weight: 550;
    font-size: 0.94rem;
    transition:
      background-color 0.15s,
      color 0.15s;
  }
  .tab:hover {
    color: var(--text);
    background: var(--surface-alt);
  }
  .tab[aria-current="page"] {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .privacy {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border: 1px solid color-mix(in srgb, var(--brand-blue) 70%, transparent);
    border-radius: 999px;
    color: var(--link);
    font-size: 0.8rem;
    font-weight: 600;
  }
  /* Narrow screens: brand on top, tabs scroll underneath. */
  @media (max-width: 980px) {
    .header-inner {
      flex-wrap: wrap;
      gap: 6px 12px;
      padding-top: 10px;
    }
    .tabs {
      order: 3;
      flex-basis: 100%;
      padding-bottom: 8px;
    }
    .privacy {
      margin-left: auto;
    }
  }
  .page {
    flex: 1;
    width: 100%;
    max-width: 1240px;
    margin: 0 auto;
    padding: 28px var(--gutter) 24px;
    outline: none;
  }
  @media (min-width: 900px) {
    .page {
      padding: 32px 28px 24px;
    }
  }
  .site-footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px 8px;
    padding: 18px var(--gutter) 24px;
    color: var(--text-muted);
    font-size: 0.85rem;
    text-align: center;
  }
  .site-footer a {
    color: var(--text-muted);
  }
  .site-footer a:hover {
    color: var(--text);
  }
</style>
