<script lang="ts">
  import { OUTPUT_STATUS, reallowFolder } from "../../engine/video-creator";
  import type { OutputFolder } from "../output-folder.svelte";
  import { app } from "../state.svelte";

  /** `downloads`: the Tier 2 line (where outputs go when no folder can be picked). */
  let { folder, disabled = false, downloads, labelId = "export-label" }: { folder: OutputFolder; disabled?: boolean; downloads: string; labelId?: string } = $props();

  const tier1 = $derived(app.capabilities?.directoryPicker ?? false);
</script>

{#if tier1}
  <div class="row">
    <input class="input path" readonly aria-labelledby={labelId} placeholder="Nothing selected" value={folder.ref?.name ?? ""} />
    <button type="button" class="btn" {disabled} onclick={() => folder.choose()}>Choose…</button>
  </div>
  {#if folder.ref}
    {#if folder.permission === "granted"}
      <p class="status ok" data-testid="output-status">{OUTPUT_STATUS.writable}</p>
    {:else if folder.permission === "prompt"}
      <p class="status" data-testid="output-status">
        <button type="button" class="link" onclick={() => folder.reallow()}>{reallowFolder(folder.ref.name)}</button>
      </p>
    {:else}
      <p class="status warn" data-testid="output-status">{OUTPUT_STATUS.notWritable}</p>
    {/if}
  {/if}
{:else}
  <p class="status value" data-testid="output-status">{downloads}</p>
{/if}

<style>
  .row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .path {
    flex: 1 1 140px;
  }
  .value {
    margin: 0;
    padding-top: 7px;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--link);
    text-decoration: underline;
    font: inherit;
    cursor: pointer;
  }
</style>
