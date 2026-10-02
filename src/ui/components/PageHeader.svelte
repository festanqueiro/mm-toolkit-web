<script lang="ts">
  import Icon from "../Icon.svelte";
  import type { IconName } from "../icons";

  let { title, subtitle = "", icon }: { title: string; subtitle?: string; icon?: IconName } = $props();
</script>

<header class="page-header">
  {#if icon}
    <span class="tile" aria-hidden="true"><Icon name={icon} size={24} /></span>
  {/if}
  <div>
    <h1>{title}</h1>
    {#if subtitle}<p>{subtitle}</p>{/if}
  </div>
</header>

<style>
  .page-header {
    display: flex;
    gap: 14px;
    align-items: center;
    margin-bottom: 22px;
  }
  .tile {
    flex: none;
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 14px;
    color: #fff;
    background: linear-gradient(135deg, var(--brand-pink), color-mix(in srgb, var(--brand-pink) 45%, var(--brand-blue)));
    box-shadow: 0 6px 18px color-mix(in srgb, var(--brand-pink) 30%, transparent);
  }
  h1 {
    margin: 0;
    font-size: clamp(1.4rem, 1.1rem + 1vw, 1.8rem);
    line-height: 1.2;
  }
  p {
    margin: 4px 0 0;
    color: var(--text-muted);
    max-width: 70ch;
  }
</style>
