<script lang="ts">
  import { formatBytes } from "../../engine/history";
  import { mediaKind } from "../../engine/media-kind";
  import type { AvailableOutput } from "../../io/history-outputs";
  import { UNAVAILABLE } from "../job-results";
  import { openHistory } from "../history.svelte";
  import RailBlock from "./RailBlock.svelte";

  /** The last job's files: player + Download each (spec: tool layout redesign, "Results"). */
  let { results, savedTo, historyId }: { results: AvailableOutput[]; savedTo: string; historyId: string | null } = $props();

  type Row = { name: string; url: string | null; size: number; video: boolean };
  let files = $state<Row[]>([]);

  // Object URLs for the current results; revoked when results change or the page unmounts.
  $effect(() => {
    // One row per name: with the "Overwrite" policy two outputs can share a name, and the last one is on disk.
    const list = [...new Map(results.map((result) => [result.name, result])).values()];
    let live = true;
    const made: Row[] = [];
    void (async () => {
      for (const result of list) {
        const file = await result.open().catch(() => null);
        if (!live) return; // torn down while opening: don't create URLs nobody will revoke
        if (!file) {
          made.push({ name: result.name, url: null, size: 0, video: false });
          continue;
        }
        made.push({ name: result.name, url: URL.createObjectURL(file), size: file.size, video: mediaKind(result.name) === "video" });
      }
      if (live) files = [...made];
    })();
    return () => {
      live = false;
      for (const f of made) if (f.url) URL.revokeObjectURL(f.url);
      files = [];
    };
  });

  function download(name: string, url: string) {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
  }
</script>

{#if results.length}
  <RailBlock title="Results">
    <p class="saved" data-testid="results-saved">
      {savedTo}{#if historyId}<span class="sep" aria-hidden="true">·</span><button type="button" class="link" onclick={() => openHistory(historyId)}>Open in History</button>{/if}
    </p>
    <ul class="results" aria-label="Results">
      {#each files as file (file.name)}
        <li>
          <div class="row">
            <span class="name" title={file.name}>{file.name}</span>
            {#if file.url}<span class="size">{formatBytes(file.size)}</span>{/if}
          </div>
          {#if !file.url}
            <p class="unavailable">{UNAVAILABLE}</p>
          {:else if file.video}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video src={file.url} controls playsinline preload="metadata" aria-label="Play {file.name}"></video>
          {:else}
            <audio src={file.url} controls preload="metadata" aria-label="Play {file.name}"></audio>
          {/if}
          {#if file.url}
            <button type="button" class="btn" onclick={() => download(file.name, file.url!)}>Download</button>
          {/if}
        </li>
      {/each}
    </ul>
  </RailBlock>
{/if}

<style>
  .unavailable {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .saved {
    margin: 0 0 10px;
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .sep {
    margin: 0 6px;
  }
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 12px;
  }
  .results li {
    display: grid;
    gap: 6px;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: baseline;
    min-width: 0;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .size {
    flex: none;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  audio,
  video {
    width: 100%;
  }
  video {
    max-height: 200px;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
  }
  li > .btn {
    justify-self: start;
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
