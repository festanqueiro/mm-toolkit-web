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

  let time = $state(0);
  let playing = $state(false);
  let loading = $state(false);
  let sceneVersion = $state(0);
  let error = $state("");

  const row = $derived(vc.selectedRow);
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

  // ---- Playback: from the slider position; the slider seeks while it plays ----
  type Pcm = Awaited<ReturnType<typeof decodeAudioFile>>;
  /** The decoded snippet, kept so seeking doesn't decode it again. */
  let decoded: { id: string; pcm: Pcm } | null = null;
  /** Bumped by every play and pause, so a superseded run can't touch the state. */
  let run = 0;
  /** A seek paused the playback: resume when the slider is released. */
  let resume = false;

  function pause() {
    run++;
    preview.stop();
    playing = false;
    loading = false;
  }

  async function play() {
    const file = row ? vc.fileFor(row.key) : undefined;
    if (!row || !file || start === null) return;
    const mine = ++run;
    vc.stopPreview();
    error = "";
    try {
      const id = `${row.key}|${start}|${row.duration}`;
      if (decoded?.id !== id) {
        loading = true;
        const pcm = await decodeAudioFile(file, { start, duration: row.duration });
        if (mine !== run) return;
        decoded = { id, pcm };
        loading = false;
      }
      const p = params();
      // On the last frame (or past it), start over.
      const from = time >= p.duration - 1 / p.fps ? 0 : time;
      playing = true;
      vc.stopLivePreview = pause;
      const finished = await preview.play(decoded.pcm, p, vc.audioFade, from, (t) => mine === run && (time = t));
      if (mine === run && finished) time = p.duration;
    } catch (e) {
      if (mine === run) error = `Preview unavailable: ${(e as Error).message}`;
    } finally {
      if (mine === run) {
        loading = false;
        playing = false;
      }
    }
  }

  /** The slider moved: while playing, hold playback and show the frames under the thumb. */
  function seek(value: number) {
    if (playing) {
      resume = true;
      pause();
    }
    time = value;
  }
  /** The slider was released (or a key moved it): carry on from there. */
  function seeked() {
    if (!resume) return;
    resume = false;
    void play();
  }

  $effect(() => {
    if (vc.running && (playing || resume)) {
      resume = false;
      pause();
    }
  });
</script>

<div class="preview">
  <div class="stage" class:empty={!scene} bind:this={container} aria-label="Live preview" role="img">
    {#if !scene}
      <div class="empty-state">
        <Icon name="music_video" size={32} />
        <p>Choose audio and a valid image or video to preview.</p>
      </div>
    {/if}
  </div>
  {#if scene}
    <div class="controls">
      <button
        type="button"
        class="btn icon"
        aria-label={playing ? "Pause preview" : "Play preview"}
        aria-pressed={playing}
        disabled={!row || start === null || loading || vc.running}
        onclick={() => (playing ? pause() : play())}
      >
        <Icon name={playing ? "pause" : "play_arrow"} />
      </button>
      <input
        type="range"
        min="0"
        max={duration}
        step={1 / vc.fps}
        aria-label="Preview position"
        value={time}
        oninput={(e) => seek(Number(e.currentTarget.value))}
        onchange={seeked}
      />
      <span class="time" data-testid="preview-time">{formatTimestamp(time)}</span>
    </div>
    {#if vc.rows.length > 1}
      <label class="track">
        Track
        <select class="input" value={vc.selectedIndex} disabled={playing} onchange={(e) => (vc.selectedKey = vc.rows[Number(e.currentTarget.value)]?.key ?? null)}>
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
    border-radius: var(--radius-sm);
    background: repeating-conic-gradient(#0b0c10 0 25%, #12141a 0 50%) 0 0 / 20px 20px;
    overflow: hidden;
  }
  /* Fill the stage, letterboxed, so small visuals aren't postage stamps. */
  .stage :global(canvas) {
    display: block;
    width: 100%;
    height: clamp(200px, 40vh, 380px);
    object-fit: contain;
  }
  .stage.empty {
    background: var(--surface-sunken);
    border: 1.5px dashed var(--border-strong);
  }
  .stage.empty :global(canvas) {
    display: none;
  }
  .empty-state {
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: 28px 16px;
    color: var(--text-muted);
    text-align: center;
  }
  .empty-state p {
    margin: 0;
    font-size: 0.92rem;
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
