<script lang="ts">
  import { untrack } from "svelte";
  import { clipRegions, dragClipEdge } from "../../../engine/clip-regions";
  import {
    clipRequest,
    clipRequests,
    clipRequirements,
    clipStatus,
    clipTitle,
    CLIPS_DOWNLOADS,
    createLabel,
    editingLabel,
    outputFormatStatus,
  } from "../../../engine/clips";
  import { reselectHint } from "../../../engine/history";
  import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from "../../../engine/media-kind";
  import { formatTimestamp } from "../../../engine/time";
  import { pickFiles } from "../../../io/pick";
  import { audioPeaks } from "../../../workers/media-client";
  import Icon from "../../Icon.svelte";
  import DropZone from "../../components/DropZone.svelte";
  import ExportFolder from "../../components/ExportFolder.svelte";
  import RailAction from "../../components/RailAction.svelte";
  import RailBlock from "../../components/RailBlock.svelte";
  import RailError from "../../components/RailError.svelte";
  import RailResults from "../../components/RailResults.svelte";
  import SetupSection from "../../components/SetupSection.svelte";
  import ToolLayout from "../../components/ToolLayout.svelte";
  import { routes } from "../../routes";
  import { openHistory } from "../../history.svelte";
  import { app } from "../../state.svelte";
  import ClipTable from "./ClipTable.svelte";
  import { FramePlayer, NativePlayer, WaveformPlayer, type PreviewPlayer } from "./players.svelte";
  import Waveform from "../../components/Waveform.svelte";
  import { cutter } from "./state.svelte";

  $effect(() => {
    if (app.settingsLoaded) cutter.restore();
  });

  // Desktop blocks closing while cutting; the web asks before leaving the page.
  $effect(() => {
    if (!cutter.running) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  });

  const subtitle = routes.find((r) => r.path === "cutter")!.subtitle;
  const accept = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS].join(",");

  // ---- Derived status (desktop `validate()`) ----
  const resolved = $derived(clipRequests(cutter.rows));
  const sourceOk = $derived(cutter.source?.ok === true);
  const req = $derived(clipRequirements({ sourceOk, clipError: resolved.error, outputOk: cutter.folder.ok, running: cutter.running }));
  const kind = $derived(cutter.kind);
  const editing = $derived(editingLabel(cutter.rows[cutter.currentIndex] ?? null, cutter.currentIndex));

  // ---- Source ----
  async function chooseSource() {
    const picked = await pickFiles({ accept });
    if (picked.files[0]) await cutter.setSource(picked.files[0].file);
  }
  async function dropSource(transfer: DataTransfer) {
    const file = transfer.files[0];
    if (file) await cutter.setSource(file);
  }

  // ---- Player: native element first, then the decoded fallbacks (spec 05) ----
  let media = $state<HTMLMediaElement | null>(null);
  let frameCanvas = $state<HTMLCanvasElement | null>(null);
  let player = $state<PreviewPlayer | null>(null);
  /** The native element failed; a fallback is loading, ready, or unavailable. */
  let fallback = $state<"none" | "loading" | "ready" | "unavailable">("none");
  /** The clip being previewed and where it stops. */
  let clipPreview = $state<{ key: string; end: number } | null>(null);
  let clipError = $state<string | null>(null);
  let frame = 0;
  let token = 0;
  /** Waveform peaks for audio the native element plays (the fallback player brings its own). */
  let nativePeaks = $state.raw<Float32Array | null>(null);
  let peaksFailed = $state(false);

  const position = $derived(player?.position ?? 0);
  const duration = $derived(player?.duration ?? 0);
  const playing = $derived(player?.playing ?? false);
  const ready = $derived(sourceOk && !!player && duration > 0);

  // ---- Waveform: every clip is a region; the current row's edges can be dragged (spec 05) ----
  const peaks = $derived(player instanceof WaveformPlayer ? player.peaks : nativePeaks);
  const regions = $derived(clipRegions(cutter.rows, duration));
  /** The row the handles edit: the current one, else row 0 (like Set Start / Set End). */
  const handleIndex = $derived(Math.max(0, cutter.currentIndex));
  const handleRow = $derived(cutter.rows[handleIndex] ?? null);

  // A new source resets the player.
  $effect(() => {
    void cutter.source?.url;
    untrack(() => {
      token++;
      stopClip();
      player?.destroy();
      player = null;
      fallback = "none";
      nativePeaks = null;
      peaksFailed = false;
    });
  });

  /**
   * The native element plays this audio: draw its waveform too. Worker only: without a
   * decoder there it would take the whole file decoded on the page, so the waveform is skipped.
   */
  async function loadPeaks() {
    const source = cutter.source;
    if (!source?.ok) return;
    const mine = token;
    try {
      const { peaks } = await audioPeaks(source.file, 1200, false);
      if (mine === token) nativePeaks = peaks;
    } catch {
      // No waveform; the fields and the timeline still work.
      if (mine === token) peaksFailed = true;
    }
  }

  // The native element, once rendered.
  $effect(() => {
    if (media && fallback === "none") untrack(() => (player = new NativePlayer(media!)));
  });

  // The frame player draws into its canvas once both exist.
  $effect(() => {
    if (frameCanvas && player instanceof FramePlayer) player.attach(frameCanvas);
  });

  /** The element can't play this source: decode it here instead. */
  async function useFallback() {
    const source = cutter.source;
    if (!source?.ok || fallback !== "none") return;
    const mine = ++token;
    stopClip();
    player?.destroy();
    player = null;
    fallback = "loading";
    try {
      const next = kind === "video" ? await FramePlayer.open(source.file) : await WaveformPlayer.open(source.file);
      if (mine !== token) return next.destroy();
      player = next;
      fallback = "ready";
    } catch {
      if (mine === token) fallback = "unavailable";
    }
  }

  function stopClip() {
    cancelAnimationFrame(frame);
    if (clipPreview) player?.pause();
    clipPreview = null;
  }

  /** Watch the playhead each frame so a clip preview stops right at its end. */
  function watchClip() {
    cancelAnimationFrame(frame);
    const tick = () => {
      if (!clipPreview || !player) return;
      if (player.now() >= clipPreview.end || !player.playing) {
        player.pause();
        clipPreview = null;
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  async function togglePlay() {
    if (!player) return;
    stopClip();
    if (player.playing) player.pause();
    else await player.play();
  }

  function seek(value: number) {
    stopClip();
    player?.seek(value);
  }

  async function previewClip(key: string) {
    clipError = null;
    if (clipPreview?.key === key) {
      stopClip();
      return;
    }
    const index = cutter.rows.findIndex((r) => r.key === key);
    const row = cutter.rows[index];
    if (!row || !player) return;
    const result = clipRequest(row);
    if ("error" in result) {
      clipError = `Clip ${index + 1}: ${result.error}`;
      return;
    }
    stopClip();
    cutter.currentKey = key;
    player.seek(result.clip.start);
    clipPreview = { key, end: result.clip.start + result.clip.duration };
    await player.play();
    if (!player.playing) clipPreview = null;
    else watchClip();
  }

  function onEdit(key: string) {
    clipError = null;
    if (clipPreview?.key === key) stopClip();
  }

  /** A handle on the waveform moved: write the row's Start or End. */
  function moveEdge(edge: "start" | "end", seconds: number) {
    const row = handleRow;
    const patch = row && dragClipEdge($state.snapshot(row), edge, seconds, duration);
    if (!row || !patch) return;
    cutter.currentKey = row.key;
    cutter.updateRow(row.key, patch);
    onEdit(row.key);
  }

  $effect(() => () => {
    cancelAnimationFrame(frame);
    player?.destroy();
  });
  $effect(() => {
    // Stop playback while a job runs.
    if (cutter.running)
      untrack(() => {
        stopClip();
        player?.pause();
      });
  });
</script>

<ToolLayout title="Media Cutter" {subtitle} icon="content_cut">
  {#snippet setup()}
    <SetupSection title="Source" status={cutter.source?.ok ? (kind === "video" ? "Video" : "Audio") : ""} tone="ok">
      <DropZone title="Source media" filled={sourceOk} disabled={cutter.running} ondropped={dropSource}>
        {#snippet icon()}<span class="tile" aria-hidden="true"><Icon name={kind === "video" ? "movie" : "audiotrack"} size={26} /></span>{/snippet}
        {#if cutter.source}
          <span class="zone-file" title={cutter.source.file.name}>{cutter.source.file.name}</span>
          <p class="status" class:ok={sourceOk} class:warn={!cutter.source.checking && !sourceOk} data-testid="source-status">
            {cutter.source.checking ? "Checking…" : cutter.source.message}
          </p>
        {:else}
          <span class="zone-hint" class:reselect={cutter.pendingSource} data-testid="source-hint">{cutter.pendingSource ? reselectHint([cutter.pendingSource]) : "Drop an audio or video file here"}</span>
        {/if}
        {#snippet actions()}
          <button type="button" class="btn" disabled={cutter.running} onclick={chooseSource}>Choose…</button>
        {/snippet}
      </DropZone>

      {#if cutter.source && sourceOk}
        <div class="player" data-testid="player" data-mode={player?.mode ?? ""}>
          {#key cutter.source.url}
            {#if fallback === "none"}
              {#if kind === "video"}
                <div class="screen">
                  <!-- svelte-ignore a11y_media_has_caption -->
                  <video
                    bind:this={media}
                    src={cutter.source.url}
                    preload="auto"
                    playsinline
                    onloadedmetadata={(e) => e.currentTarget.videoWidth === 0 && useFallback()}
                    onloadeddata={(e) => (e.currentTarget.currentTime = 0)}
                    onerror={useFallback}
                  ></video>
                </div>
              {:else}
                <audio bind:this={media} src={cutter.source.url} preload="auto" onloadedmetadata={loadPeaks} onerror={useFallback}></audio>
              {/if}
            {:else if fallback === "ready" && player instanceof FramePlayer}
              <div class="screen">
                <canvas bind:this={frameCanvas} class="frames" aria-label="Video preview of {cutter.source.file.name}"></canvas>
              </div>
            {/if}
          {/key}
          {#if kind === "audio" && peaks && duration > 0}
            <Waveform
              {peaks}
              {duration}
              {position}
              {regions}
              currentKey={handleRow?.key ?? null}
              currentLabel={handleRow ? clipTitle(handleRow.title, handleIndex) : ""}
              disabled={cutter.running}
              onseek={seek}
              onselect={(key) => (cutter.currentKey = key)}
              onedge={moveEdge}
            />
          {:else if kind === "audio" && !peaksFailed && fallback !== "unavailable"}
            <!-- Hold the waveform's space while it loads, so the controls below don't jump. -->
            <div class="waveform-pending" data-testid="waveform-pending" aria-hidden="true"></div>
          {/if}
        </div>
        {#if fallback === "loading"}
          <p class="status" data-testid="preview-status">Preparing a preview of {cutter.source.file.name}…</p>
        {:else if fallback === "unavailable"}
          <p class="status warn" data-testid="preview-status">This browser can't preview {cutter.source.file.name}. You can still type timestamps and create clips.</p>
        {/if}

        <div class="timeline">
          <input
            type="range"
            min="0"
            max={duration || 0}
            step="any"
            aria-label="Timeline"
            disabled={!ready}
            value={position}
            oninput={(e) => seek(Number(e.currentTarget.value))}
          />
          <span class="time" data-testid="player-time">{formatTimestamp(position)} / {formatTimestamp(duration)}</span>
        </div>

        <div class="transport">
          <button type="button" class="btn" disabled={!ready || cutter.running} onclick={togglePlay}>
            <Icon name={playing ? "pause" : "play_arrow"} size={18} />
            {playing ? "Pause" : "Play"}
          </button>
          <span class="editing" data-testid="editing">{editing}</span>
          <button type="button" class="btn" disabled={!ready || cutter.running} onclick={() => cutter.setFromPlayer("start", player?.now() ?? 0)}>Set Start</button>
          <button type="button" class="btn" disabled={!ready || cutter.running} onclick={() => cutter.setFromPlayer("end", player?.now() ?? 0)}>Set End</button>
        </div>
      {/if}
    
    </SetupSection>
    <SetupSection title="Clips">
      <ClipTable previewKey={clipPreview?.key ?? null} onpreview={previewClip} onedit={onEdit} disabled={cutter.running} />
      <div class="below-table">
        <button type="button" class="btn" disabled={cutter.running} onclick={() => cutter.addRow()}>
          <Icon name="add" size={18} /> Add clip
        </button>
      </div>
      <p class="status" class:ok={!resolved.error && !clipError} class:warn={!!(resolved.error || clipError)} data-testid="clip-status" aria-live="polite">
        {clipError ?? clipStatus(resolved)}
      </p>
    
    </SetupSection>
  {/snippet}

  {#snippet rail()}
    <RailBlock title="Export">
      <div class="stack">
        <span class="label" id="clips-export-label">Export folder</span>
        <ExportFolder folder={cutter.folder} disabled={cutter.running} downloads={CLIPS_DOWNLOADS} labelId="clips-export-label" />
        {#if kind && cutter.format}
          <p class="status ok" data-testid="format-status">{outputFormatStatus(kind, cutter.format)}</p>
        {/if}
      </div>
    </RailBlock>
  {/snippet}

  {#snippet action()}
    <RailAction
      progress={cutter.progress}
      running={cutter.running}
      cancelling={cutter.cancelling}
      warnings={cutter.warnings}
      requirement={req}
      label={createLabel(kind)}
      progressLabel="Clip progress"
      onstatus={cutter.lastJobId && !cutter.running ? () => openHistory(cutter.lastJobId) : null}
      onclear={() => cutter.clear()}
      oncancel={() => cutter.cancel()}
      onstart={() => cutter.create()}
    />
  {/snippet}

  {#snippet after()}
    <RailError title="Clip creation failed" failure={cutter.failure} ondismiss={() => (cutter.failure = null)} />
    <RailResults results={cutter.results} savedTo={cutter.savedTo} historyId={cutter.lastJobId} />
  {/snippet}
</ToolLayout>

<style>
  .stack {
    display: grid;
    gap: 8px;
  }
  .stack .label {
    font-weight: 600;
  }
  .screen {
    margin-top: 14px;
    aspect-ratio: 16 / 9;
    min-height: 220px;
    /* The setup column is wide now: cap the player so the Clips table stays in reach. */
    max-height: min(420px, 50vh);
    margin-inline: auto;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    border: 1px solid var(--border);
    overflow: hidden;
  }
  /* Phones: keep 16:9 within the column (the desktop minimum would overflow it). */
  @media (max-width: 560px) {
    .screen {
      min-height: 0;
    }
    .editing {
      order: -1;
      flex-basis: 100%;
    }
  }
  .waveform-pending {
    height: 120px;
    margin-top: 14px;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    border: 1px solid var(--border);
  }
  .frames {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .timeline {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-top: 14px;
  }
  .timeline input {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
  }
  .time {
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
    font-size: 0.92rem;
    white-space: nowrap;
  }
  .transport {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-top: 10px;
  }
  .transport .btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .editing {
    flex: 1;
    min-width: 120px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .below-table {
    margin-top: 10px;
  }
  .below-table .btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
</style>
