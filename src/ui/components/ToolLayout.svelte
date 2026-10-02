<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import type { IconName } from "../icons";
  import PageHeader from "./PageHeader.svelte";

  /**
   * Tool page: setup (75 %, scrollable, always-open sections) | sticky output rail (25 %).
   * Under 1000 px everything stacks and the action moves to a sticky bottom bar. The action
   * renders exactly once (rail when wide, bar when narrow) so it never exists twice.
   */
  let {
    title,
    subtitle,
    icon,
    setup,
    rail,
    action,
    after,
  }: { title: string; subtitle: string; icon: IconName; setup: Snippet; rail: Snippet; action: Snippet; after: Snippet } = $props();

  let wide = $state(matchMedia("(min-width: 1000px)").matches);
  let page = $state<HTMLElement>();
  const actionHost = () => page?.querySelector<HTMLElement>("[data-action-host]") ?? null;
  $effect(() => {
    const query = matchMedia("(min-width: 1000px)");
    const update = async () => {
      // The action is re-created in its new place; keep keyboard focus on the same control.
      const host = actionHost();
      const controls = host ? [...host.querySelectorAll<HTMLElement>("button, a, input, select")] : [];
      const focused = controls.indexOf(document.activeElement as HTMLElement);
      wide = query.matches;
      if (focused < 0) return;
      await tick();
      actionHost()?.querySelectorAll<HTMLElement>("button, a, input, select")[focused]?.focus();
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  });
</script>

<div class="tool-page" bind:this={page}>
  <PageHeader {title} {subtitle} {icon} />
  <div class="tool" class:wide>
    <div class="setup">{@render setup()}</div>
    <aside class="rail" aria-label="Output" data-testid="rail">
      {@render rail()}
      {#if wide}
        <div class="rail-action-block" data-action-host>{@render action()}</div>
      {/if}
      {@render after()}
    </aside>
  </div>
  {#if !wide}
    <div class="bar" data-testid="action-bar" data-action-host>{@render action()}</div>
  {/if}
</div>

<style>
  .tool-page {
    /* Tool pages get more room than text pages (1240 px). */
    width: min(1440px, 100%);
    margin-inline: auto;
  }
  .tool {
    display: grid;
    gap: 20px;
    align-items: start;
  }
  .setup,
  .rail {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }
  .tool.wide {
    grid-template-columns: minmax(0, 1fr) clamp(340px, 28%, 420px);
  }
  .tool.wide .rail {
    position: sticky;
    top: 76px;
    max-height: calc(100vh - 96px);
    overflow: hidden auto;
    /* A visible (non-overlay) scrollbar mustn't squeeze the content into a sideways scroll. */
    scrollbar-gutter: stable;
    padding-bottom: 4px;
  }
  .rail-action-block {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    padding: 14px 16px;
    /* When Preview + Export overflow the rail, the action stays pinned to its bottom. */
    position: sticky;
    bottom: 0;
    z-index: 1;
  }
  .bar {
    position: sticky;
    bottom: 12px;
    z-index: 10;
    margin-top: 16px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: var(--shadow-md);
  }
</style>
