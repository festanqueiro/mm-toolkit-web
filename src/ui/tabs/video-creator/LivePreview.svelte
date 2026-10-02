<script lang="ts">
  import { onDestroy } from "svelte";
  import { formatTimestamp, parseTimestamp } from "../../../engine/time";
  import { canvasSize, PROFILES, previewSize, type Size } from "../../../engine/video-creator";
  import { bassEnvelope, decodeAudioFile } from "../../../workers/media-client";
  import Icon from "../../Icon.svelte";
  import { LivePreview, type PreviewParams, type PreviewScene } from "./live-preview";
  import { vc } from "./state.svelte";

  const preview = new LivePreview();
  let container: HTMLDivElement | undefined = $state();
  $effect(() => {
    if (container) preview.mount(container);
  });
  onDestroy(() => preview.dispose());

  let trackIndex = $state(0);
  let time = $state(0);
  let playing = $state(false);
  let loading = $state(false);
  let sceneVersion = $state(0);
  let error = $state("");

  const row = $derived(vc.rows[Math.min(trackIndex, vc.rows.length - 1)] ?? null);
  const start = $derived.by(() => {
    if (!row) return null;
    try {
      return parseTimestamp(row.start);
    } catch {
      return null;
    }
  });

  // ---- Scene: everything that needs the layers rebuilt ----
  const scene = $derived.by((): PreviewScene | null => {
    const visual = vc.visual;
    const file = vc.visualFile;
    if (!visual?.ok || !file) return null;
    const profile = PROFILES[vc.profile]?.size ?? null;
    const size: Size = previewSize(canvasSize(profile, [visual.width, visual.height]));
    const bg = vc.effects.background;
    return {
      size,
      fitted: profile !== null,
      backgroundColor: [...bg.color],
      backgroundImage: bg.mode === "image" ? vc.layers.background.image : null,
      overlay: vc.layers.overlay.image,
      visual: visual.kind === "video" ? { kind: "video", file, duration: visual.duration ?? 0 } : { kind: "image", file },
    };
  });

  $effect(() => {
    const next = scene;
    if (!next) return;
    playing = false;
    preview
      .setScene(next)
      .then((applied) => {
        if (applied) sceneVersion++;
      })
      .catch((e) => (error = `Preview unavailable: ${(e as Error).message}`));
  });

  // ---- Bass envelope of the selected snippet (the render uses the same one) ----
  let envelope = $state.raw<{ id: string; values: Float64Array; duration: number } | null>(null);
  const envelopeId = $derived(row && start !== null ? `${row.key}|${start}|${row.duration}|${vc.fps}` : null);
  $effect(() => {
    const id = envelopeId;
    const file = row ? vc.fileFor(row.key) : undefined;
    if (!id || !file || start === null || !row) {
      envelope = null;
      return;
    }
    if (envelope?.id === id) return;
    bassEnvelope(file, { start, duration: row.duration }, vc.fps)
      .then((result) => {
        if (envelopeId === id) envelope = { id, values: result.envelope, duration: result.duration };
      })
      .catch(() => (envelope = null));
  });

  const duration = $derived(envelope?.id === envelopeId && envelope ? envelope.duration : (row?.duration ?? 10));

  function params(): PreviewParams {
    return {
      settings: $state.snapshot(vc.effects),
      fps: vc.fps,
      videoFade: vc.videoFade,
      envelope: envelope?.id === envelopeId ? (envelope?.values ?? null) : null,
      duration,
    };
  }

  // ---- Idle frame: redraw whenever anything visible changes ----
  $effect(() => {
    void sceneVersion;
    const p = params();
    const t = Math.min(time, Math.max(0, p.duration - 1 / p.fps));
    if (!sceneVersion || playing) return;
    preview.renderAt(Math.floor(t * p.fps) / p.fps, p).catch(() => {});
  });

  // ---- Playback ----
  async function togglePlay() {
    if (playing) {
      preview.stop();
      playing = false;
      return;
    }
    const file = row ? vc.fileFor(row.key) : undefined;
    if (!row || !file || start === null) return;
    vc.stopPreview();
    loading = true;
    error = "";
    try {
      const pcm = await decodeAudioFile(file, { start, duration: row.duration });
      loading = false;
      playing = true;
      vc.stopLivePreview = () => {
        preview.stop();
        playing = false;
      };
      await preview.play(pcm, params(), vc.audioFade, (t) => (time = t));
    } catch (e) {
      error = `Preview unavailable: ${(e as Error).message}`;
    } finally {
      loading = false;
      playing = false;
    }
  }

  $effect(() => {
    if (vc.running && playing) {
      preview.stop();
      playing = false;
    }
  });
</script>

<div class="preview">
  <div class="stage" bind:this={container} aria-label="Live preview" role="img"></div>
  {#if !scene}
    <p class="status">Choose audio and a valid image or video to preview.</p>
  {:else}
    <div class="controls">
      <button
        type="button"
        class="btn icon"
        aria-label={playing ? "Stop preview" : "Play preview"}
        aria-pressed={playing}
        disabled={!row || start === null || loading || vc.running}
        onclick={togglePlay}
      >
        <Icon name={playing ? "stop" : "play_arrow"} />
      </button>
      <input
        type="range"
        min="0"
        max={duration}
        step={1 / vc.fps}
        aria-label="Preview position"
        disabled={playing}
        bind:value={time}
      />
      <span class="time" data-testid="preview-time">{formatTimestamp(time)}</span>
    </div>
    {#if vc.rows.length > 1}
      <label class="track">
        Track
        <select class="input" bind:value={trackIndex} disabled={playing}>
          {#each vc.rows as r, i (r.key)}
            <option value={i}>{i + 1}. {r.name}</option>
          {/each}
        </select>
      </label>
    {/if}
    {#if row && start === null}
      <p class="status warn">Fix this track's start time to preview it with audio.</p>
    {/if}
    {#if error}
      <p class="status warn">{error}</p>
    {/if}
  {/if}
</div>

<style>
  .preview {
    display: grid;
    gap: 8px;
  }
  .stage {
    display: grid;
    place-items: center;
    min-height: 120px;
    border-radius: 8px;
    background: #000;
    overflow: hidden;
  }
  .stage :global(canvas) {
    display: block;
    max-width: 100%;
    max-height: 420px;
    width: auto;
    height: auto;
  }
  .controls {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .controls input[type="range"] {
    flex: 1;
    accent-color: var(--accent);
  }
  .time {
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }
  .track {
    display: flex;
    gap: 8px;
    align-items: center;
    font-weight: 600;
  }
  .track select {
    flex: 1;
    min-width: 0;
    font-weight: 400;
  }
</style>
