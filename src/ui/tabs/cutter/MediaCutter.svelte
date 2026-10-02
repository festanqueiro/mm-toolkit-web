<script lang="ts">
  import { untrack } from "svelte";
  import {
    clipRequest,
    clipRequests,
    clipRequirements,
    clipStatus,
    CLIPS_DOWNLOADS,
    createLabel,
    editingLabel,
    kindWord,
    outputFormatStatus,
  } from "../../../engine/clips";
  import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from "../../../engine/media-kind";
  import { formatTimestamp } from "../../../engine/time";
  import { pickFiles } from "../../../io/pick";
  import Icon from "../../Icon.svelte";
  import DropZone from "../../components/DropZone.svelte";
  import ExportFolder from "../../components/ExportFolder.svelte";
  import JobFooter from "../../components/JobFooter.svelte";
  import Modal from "../../components/Modal.svelte";
  import PageHeader from "../../components/PageHeader.svelte";
  import Section from "../../components/Section.svelte";
  import { routes } from "../../routes";
  import { app } from "../../state.svelte";
  import ClipTable from "./ClipTable.svelte";
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

  // ---- Player (native <video>/<audio>) ----
  let media = $state<HTMLMediaElement | null>(null);
  let position = $state(0);
  let duration = $state(0);
  let playing = $state(false);
  /** False when this browser can't play the source natively (cutting still works). */
  let playable = $state(true);
  /** The clip being previewed and where it stops. */
  let clipPreview = $state<{ key: string; end: number } | null>(null);
  let clipError = $state<string | null>(null);
  let frame = 0;

  const ready = $derived(sourceOk && playable && duration > 0);

  // A new source resets the player.
  $effect(() => {
    void cutter.source?.url;
    untrack(() => {
      position = 0;
      duration = 0;
      playing = false;
      playable = true;
      stopClip();
    });
  });

  function stopClip() {
    cancelAnimationFrame(frame);
    if (clipPreview) media?.pause();
    clipPreview = null;
  }

  /** Watch the playhead each frame so a clip preview stops right at its end. */
  function watchClip() {
    cancelAnimationFrame(frame);
    const tick = () => {
      if (!clipPreview || !media) return;
      if (media.currentTime >= clipPreview.end || media.ended) {
        media.pause();
        clipPreview = null;
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  async function togglePlay() {
    if (!media) return;
    stopClip();
    if (media.paused) await media.play().catch(() => {});
    else media.pause();
  }

  function seek(value: number) {
    stopClip();
    if (media) media.currentTime = value;
    position = value;
  }

  async function previewClip(key: string) {
    clipError = null;
    if (clipPreview?.key === key) {
      stopClip();
      return;
    }
    const index = cutter.rows.findIndex((r) => r.key === key);
    const row = cutter.rows[index];
    if (!row || !media) return;
    const result = clipRequest(row);
    if ("error" in result) {
      clipError = `Clip ${index + 1}: ${result.error}`;
      return;
    }
    stopClip();
    cutter.currentKey = key;
    media.currentTime = result.clip.start;
    clipPreview = { key, end: result.clip.start + result.clip.duration };
    await media.play().catch(() => (clipPreview = null));
    watchClip();
  }

  function onEdit(key: string) {
    clipError = null;
    if (clipPreview?.key === key) stopClip();
  }

  $effect(() => () => cancelAnimationFrame(frame));
  $effect(() => {
    // Stop playback while a job runs.
    if (cutter.running)
      untrack(() => {
        stopClip();
        media?.pause();
      });
  });
</script>

<PageHeader title="Media Cutter" {subtitle} icon="content_cut" />

<div class="columns">
  <div class="column">
    <Section title="Input">
      <DropZone title="Source media" filled={sourceOk} disabled={cutter.running} ondropped={dropSource}>
        {#snippet icon()}<span class="tile" aria-hidden="true"><Icon name={kind === "video" ? "movie" : "audiotrack"} size={26} /></span>{/snippet}
        {#if cutter.source}
          <span class="zone-file" title={cutter.source.file.name}>{cutter.source.file.name}</span>
          <p class="status" class:ok={sourceOk} class:warn={!cutter.source.checking && !sourceOk} data-testid="source-status">
            {cutter.source.checking ? "Checking…" : cutter.source.message}
          </p>
        {:else}
          <span class="zone-hint">Drop an audio or video file here</span>
        {/if}
        {#snippet actions()}
          <button type="button" class="btn" disabled={cutter.running} onclick={chooseSource}>Choose…</button>
        {/snippet}
      </DropZone>

      {#if cutter.source && sourceOk}
        {#key cutter.source.url}
          {#if kind === "video"}
            <div class="screen">
              <!-- svelte-ignore a11y_media_has_caption -->
              <video
                bind:this={media}
                src={cutter.source.url}
                preload="auto"
                playsinline
                onloadedmetadata={(e) => (duration = e.currentTarget.duration)}
                onloadeddata={(e) => (e.currentTarget.currentTime = 0)}
                ontimeupdate={(e) => (position = e.currentTarget.currentTime)}
                onplay={() => (playing = true)}
                onpause={() => (playing = false)}
                onerror={() => (playable = false)}
              ></video>
            </div>
          {:else}
            <audio
              bind:this={media}
              src={cutter.source.url}
              preload="auto"
              onloadedmetadata={(e) => (duration = e.currentTarget.duration)}
              ontimeupdate={(e) => (position = e.currentTarget.currentTime)}
              onplay={() => (playing = true)}
              onpause={() => (playing = false)}
              onerror={() => (playable = false)}
            ></audio>
          {/if}
        {/key}
        {#if !playable}
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
          <button type="button" class="btn" disabled={!ready || cutter.running} onclick={() => cutter.setFromPlayer("start", media?.currentTime ?? 0)}>Set Start</button>
          <button type="button" class="btn" disabled={!ready || cutter.running} onclick={() => cutter.setFromPlayer("end", media?.currentTime ?? 0)}>Set End</button>
        </div>
      {/if}
    </Section>
  </div>

  <div class="column">
    <Section title="Clip timestamps">
      <ClipTable previewKey={clipPreview?.key ?? null} onpreview={previewClip} onedit={onEdit} disabled={cutter.running} />
      <div class="below-table">
        <button type="button" class="btn" disabled={cutter.running} onclick={() => cutter.addRow()}>
          <Icon name="add" size={18} /> Add clip
        </button>
      </div>
      <p class="status" class:ok={!resolved.error && !clipError} class:warn={!!(resolved.error || clipError)} data-testid="clip-status" aria-live="polite">
        {clipError ?? clipStatus(resolved)}
      </p>
    </Section>

    <Section title="{kindWord(kind)} clip output">
      <div class="form">
        <span class="label" id="clips-export-label">Export folder</span>
        <div class="field">
          <ExportFolder folder={cutter.folder} disabled={cutter.running} downloads={CLIPS_DOWNLOADS} labelId="clips-export-label" />
          {#if kind && cutter.format}
            <p class="status ok" data-testid="format-status">{outputFormatStatus(kind, cutter.format)}</p>
          {/if}
        </div>
      </div>
    </Section>
  </div>
</div>

<JobFooter
  progress={cutter.progress}
  running={cutter.running}
  cancelling={cutter.cancelling}
  warnings={cutter.warnings}
  requirement={req}
  label={createLabel(kind)}
  progressLabel="Clip progress"
  onclear={() => cutter.clear()}
  oncancel={() => cutter.cancel()}
  onstart={() => cutter.create()}
/>

<Modal title="Clip creation failed" open={cutter.failure !== null} onclose={() => (cutter.failure = null)}>
  <p>{cutter.failure?.message}</p>
  {#if cutter.failure?.details}
    <details>
      <summary>Details</summary>
      <pre>{cutter.failure.details}</pre>
    </details>
  {/if}
  {#snippet actions()}
    <button type="button" class="btn primary" onclick={() => (cutter.failure = null)}>OK</button>
  {/snippet}
</Modal>

<style>
  .columns {
    display: grid;
    gap: 16px;
    align-items: start;
  }
  @media (min-width: 900px) {
    .columns {
      grid-template-columns: minmax(0, 5fr) minmax(0, 4fr);
    }
  }
  .column {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .screen {
    margin-top: 14px;
    aspect-ratio: 16 / 9;
    min-height: 220px;
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
  .form {
    display: grid;
    grid-template-columns: minmax(110px, 150px) 1fr;
    gap: 12px 14px;
    align-items: start;
  }
  @media (max-width: 560px) {
    .form {
      grid-template-columns: 1fr;
      gap: 6px;
    }
  }
  .label {
    padding-top: 7px;
    font-weight: 600;
  }
  .field {
    min-width: 0;
  }
  pre {
    max-height: 200px;
    overflow: auto;
    font-size: 0.8rem;
    white-space: pre-wrap;
  }
</style>
