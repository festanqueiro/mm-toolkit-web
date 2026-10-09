<script lang="ts">
  /**
   * The selected track's waveform with its snippet as a region (spec 04, web only): the start
   * handle slides the snippet, the end handle sets its Duration.
   */
  import { SvelteMap } from "svelte/reactivity";
  import { dragTrackEdge, trackRegion } from "../../../engine/clip-regions";
  import { formatTimestamp } from "../../../engine/time";
  import { audioPeaks } from "../../../workers/media-client";
  import Waveform from "../../components/Waveform.svelte";
  import WaveformPending from "../../components/WaveformPending.svelte";
  import { vc } from "./state.svelte";

  type Peaks = { peaks: Float32Array; duration: number };

  const row = $derived(vc.selectedRow);
  /** Peaks per track, kept so going back to a track doesn't decode it again (`null`: no waveform for it). */
  const cache = new SvelteMap<string, Peaks | "loading" | null>();
  /** How far each loading track's decode is (0–1). */
  const progress = new SvelteMap<string, number>();

  $effect(() => {
    const key = row?.key;
    const file = key ? vc.fileFor(key) : undefined;
    // Forget tracks that are no longer listed.
    for (const cached of [...cache.keys()]) {
      if (vc.rows.some((r) => r.key === cached)) continue;
      cache.delete(cached);
      progress.delete(cached);
    }
    if (!key || !file || cache.has(key)) return;
    cache.set(key, "loading");
    // Worker only: without a decoder there, the whole file would be decoded on the page (spec 05).
    audioPeaks(file, 1200, false, (fraction) => cache.get(key) === "loading" && progress.set(key, fraction))
      .catch(() => null)
      .then((peaks) => {
        if (cache.get(key) === "loading") cache.set(key, peaks);
        progress.delete(key);
      });
  });

  const entry = $derived(row ? cache.get(row.key) : undefined);
  const data = $derived(entry && entry !== "loading" ? entry : null);
  const region = $derived(row && data ? trackRegion(row, data.duration) : null);

  function moveEdge(edge: "start" | "end", seconds: number) {
    const patch = row && data && dragTrackEdge($state.snapshot(row), edge, seconds, data.duration);
    if (row && patch) vc.updateRow(row.key, patch);
  }
</script>

{#if row && entry !== null}
  <div class="track-waveform">
    {#if vc.rows.length > 1}
      <p class="name" data-testid="track-waveform-name" title={row.name}>{row.name}</p>
    {/if}
    {#if data}
      <Waveform
        peaks={data.peaks}
        duration={data.duration}
        regions={region ? [region] : []}
        currentKey={row.key}
        currentLabel={row.name}
        disabled={vc.running}
        onedge={moveEdge}
        onmove={(seconds) => moveEdge("start", seconds)}
        edgeText={(edge, seconds) => (edge === "end" ? `${row.duration} s` : formatTimestamp(seconds))}
      />
    {:else}
      <WaveformPending progress={progress.get(row.key) ?? null} />
    {/if}
  </div>
{/if}

<style>
  .name {
    margin: 12px 0 -8px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
