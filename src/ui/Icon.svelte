<script lang="ts">
  import { icons, type IconName } from "./icons";

  let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>

<span class="icon" style:width="{size}px" style:height="{size}px">
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- bundled, trusted SVG assets -->
  {@html icons[name]}
</span>

<style>
  .icon {
    display: inline-flex;
    flex: none;
  }
  .icon :global(svg) {
    width: 100%;
    height: 100%;
  }
</style>
