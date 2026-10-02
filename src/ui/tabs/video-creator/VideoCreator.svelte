<script lang="ts">
  import { IMAGE_EXTENSIONS, AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from "../../../engine/media-kind";
  import {
    audioStatus,
    dropDialogMessage,
    generateLabel,
    hexColor,
    PROFILES,
    requirements,
    trackOptions,
  } from "../../../engine/video-creator";
  import { filesFromDrop, pickFiles } from "../../../io/pick";
  import Icon from "../../Icon.svelte";
  import Accordion from "../../components/Accordion.svelte";
  import Modal from "../../components/Modal.svelte";
  import PageHeader from "../../components/PageHeader.svelte";
  import { routes } from "../../routes";
  import { app } from "../../state.svelte";
  import EffectsList from "./EffectsList.svelte";
  import Layers from "./Layers.svelte";
  import LivePreview from "./LivePreview.svelte";
  import Output from "./Output.svelte";
  import { vc } from "./state.svelte";
  import TrackTable from "./TrackTable.svelte";

  $effect(() => {
    if (app.settingsLoaded) vc.restore();
  });

  const subtitle = routes.find((r) => r.path === "video-creator")!.subtitle;

  type Left = "input" | "timestamps";
  type Right = "effects" | "layers" | "post" | "output";
  let leftOpen = $state<Left | null>("input");
  let rightOpen = $state<Right | null>("output");
  const toggleLeft = (key: Left) => (leftOpen = leftOpen === key ? null : key);
  const toggleRight = (key: Right) => (rightOpen = rightOpen === key ? null : key);

  const audioAccept = AUDIO_EXTENSIONS.join(",");
  const visualAccept = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].join(",");

  // ---- Derived status (desktop `validate()`) ----
  const tracks = $derived(trackOptions(vc.rows));
  const musicOk = $derived(vc.trackCount > 0);
  const visualOk = $derived(vc.visual?.ok === true);
  const downstreamReady = $derived(musicOk && visualOk && !vc.running);
  /** Tier 2 exports through Downloads (always available); Tier 1 needs a folder with write permission. */
  const outputOk = $derived(!app.capabilities?.directoryPicker || (vc.output !== null && vc.outputPermission === "granted"));
  const isVideo = $derived(vc.visual?.ok === true && vc.visual.kind === "video");
  let previewOpen = $state(true);
  const req = $derived(
    requirements({
      trackCount: vc.trackCount,
      visualOk,
      outputOk,
      trackError: tracks.error,
      analysing: vc.analysingKey !== null,
      running: vc.running,
    }),
  );
  const visualStatus = $derived(
    vc.visualChecking ? "Checking…" : vc.visual ? (vc.visual.ok ? `✓ ${vc.visual.message}` : vc.visual.message) : "",
  );

  // ---- Audio / visual selection ----
  async function chooseAudioFile() {
    vc.setAudio(await pickFiles({ accept: audioAccept }));
  }
  async function chooseAudioFolder() {
    vc.setAudio(await pickFiles({ directory: true }));
  }
  async function chooseVisual() {
    const picked = await pickFiles({ accept: visualAccept });
    if (picked.files[0]) await vc.setVisual(picked.files[0].file);
  }

  let dragTarget = $state<"audio" | "visual" | null>(null);
  const dragOver = (target: "audio" | "visual") => (event: DragEvent) => {
    if (vc.running || !event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    dragTarget = target;
  };
  async function dropAudio(event: DragEvent) {
    event.preventDefault();
    dragTarget = null;
    if (event.dataTransfer && !vc.running) vc.setAudio(await filesFromDrop(event.dataTransfer));
  }
  async function dropVisual(event: DragEvent) {
    event.preventDefault();
    dragTarget = null;
    const file = event.dataTransfer?.files[0];
    if (file && !vc.running) await vc.setVisual(file);
  }

  // ---- Drop detection dialog ----
  let dropDialogOpen = $state(false);
  let dropKey = $state<string | null>(null);
  let leadIn = $state(2);
  function openDropDialog(key: string) {
    if (vc.analysingKey) return;
    dropKey = key;
    leadIn = vc.leadIn;
    dropDialogOpen = true;
  }
  function analyse() {
    const value = Math.min(60, Math.max(0, Math.round((Number(leadIn) || 0) * 10) / 10));
    dropDialogOpen = false;
    if (dropKey) void vc.detectDrop(dropKey, value);
  }

  // ---- Collapsed-section summaries ----
  const EFFECT_NAMES = { overlay: "Overlay", bass_blur: "Blur", rotate: "Rotate", vhs: "VHS", glitch: "Glitch" } as const;
  const effectsSummary = $derived(vc.effects.order.filter((k) => vc.effects[k].enabled).map((k) => EFFECT_NAMES[k]).join(" → ") || "None");
  const layersSummary = $derived(
    (vc.effects.background.mode === "image" ? "Image background" : hexColor(vc.effects.background.color)) +
      (vc.layers.overlay.image ? " + overlay" : ""),
  );
  const postSummary = $derived(
    [vc.videoFade && "video fade", vc.audioFade && "audio fade"].filter(Boolean).join(", ") || "No fades",
  );
  const outputSummary = $derived(`${PROFILES[vc.profile]?.label ?? ""} · ${vc.fps} fps`);

  // ---- Preview ----
  let previewError = $state<string | null>(null);
  async function preview(key: string) {
    previewError = await vc.togglePreview(key);
  }
</script>

<PageHeader title="Video Creator" {subtitle} icon="music_video" />

<div class="columns">
  <div class="column">
    <Accordion title="Input" open={leftOpen === "input"} ontoggle={() => toggleLeft("input")} disabled={vc.running}>
      <div class="zones">
        <div
          class="zone"
          class:filled={musicOk}
          class:dragging={dragTarget === "audio"}
          role="group"
          aria-labelledby="audio-label"
          ondragover={dragOver("audio")}
          ondragleave={() => (dragTarget = null)}
          ondrop={dropAudio}
        >
          <span class="zone-icon" aria-hidden="true"><Icon name={vc.audio?.folder ? "folder_open" : "audiotrack"} size={26} /></span>
          <div class="zone-body">
            <span class="zone-title" id="audio-label">Audio</span>
            {#if vc.audio}
              <span class="zone-file" title={vc.audio.label}>{vc.audio.label}</span>
              <p class="status" class:ok={musicOk} class:warn={!musicOk} data-testid="audio-status">{audioStatus(vc.trackCount, true)}</p>
            {:else}
              <span class="zone-hint">Drop an audio file or a folder here</span>
            {/if}
          </div>
          <div class="zone-actions">
            <button type="button" class="btn" onclick={chooseAudioFile}>Choose File…</button>
            <button type="button" class="btn" onclick={chooseAudioFolder}>Choose Folder…</button>
          </div>
        </div>

        <div
          class="zone"
          class:filled={visualOk}
          class:dragging={dragTarget === "visual"}
          role="group"
          aria-labelledby="visual-label"
          ondragover={dragOver("visual")}
          ondragleave={() => (dragTarget = null)}
          ondrop={dropVisual}
        >
          {#if vc.visual?.ok}
            <span class="thumb"><img src={vc.visual.thumbnail} alt="Preview of {vc.visualFile?.name}" /></span>
          {:else}
            <span class="zone-icon" aria-hidden="true"><Icon name="image" size={26} /></span>
          {/if}
          <div class="zone-body">
            <span class="zone-title" id="visual-label">Image or video</span>
            {#if vc.visualFile}
              <span class="zone-file" title={vc.visualFile.name}>{vc.visualFile.name}</span>
            {:else}
              <span class="zone-hint">Drop an image or video here</span>
            {/if}
            {#if visualStatus}
              <p class="status" class:ok={vc.visual?.ok} class:warn={vc.visual && !vc.visual.ok} data-testid="visual-status">{visualStatus}</p>
            {/if}
          </div>
          <div class="zone-actions">
            <button type="button" class="btn" onclick={chooseVisual}>Choose…</button>
          </div>
        </div>
      </div>
    </Accordion>

    <Accordion
      title="Audio timestamps"
      grow
      summary={musicOk ? `${vc.trackCount} track${vc.trackCount === 1 ? "" : "s"}` : ""}
      open={leftOpen === "timestamps"}
      ontoggle={() => toggleLeft("timestamps")}
      disabled={!musicOk || vc.running}
    >
      {#if vc.rows.length}
        <TrackTable ondetect={openDropDialog} onpreview={preview} />
      {/if}
      {#if vc.timestampsStatus}
        <p class="status" data-testid="timestamps-status" aria-live="polite">{vc.timestampsStatus}</p>
      {/if}
    </Accordion>
  </div>

  <div class="column">
    <Accordion title="Preview" open={previewOpen} ontoggle={() => (previewOpen = !previewOpen)}>
      <LivePreview />
    </Accordion>
    <Accordion
      title="Visual Effects"
      summary={downstreamReady ? effectsSummary : ""}
      open={rightOpen === "effects"}
      ontoggle={() => toggleRight("effects")}
      disabled={!downstreamReady}
    >
      <EffectsList disabled={!downstreamReady} />
    </Accordion>
    <Accordion
      title="Layers"
      summary={downstreamReady ? layersSummary : ""}
      open={rightOpen === "layers"}
      ontoggle={() => toggleRight("layers")}
      disabled={!downstreamReady}
    >
      <Layers disabled={!downstreamReady} />
    </Accordion>
    <Accordion
      title="Post-Effects"
      summary={downstreamReady ? postSummary : ""}
      open={rightOpen === "post"}
      ontoggle={() => toggleRight("post")}
      disabled={!downstreamReady}
    >
      <div class="form">
        {#if isVideo}
          <span class="label">Video sound</span>
          <label class="check"><input type="checkbox" bind:checked={vc.muteOriginal} /> Mute original video sound</label>
        {/if}
        <span class="label">Video</span>
        <label class="check"><input type="checkbox" bind:checked={vc.videoFade} /> Fade video in/out</label>
        <span class="label">Audio</span>
        <label class="check"><input type="checkbox" bind:checked={vc.audioFade} /> Fade audio in/out</label>
      </div>
    </Accordion>
    <Accordion
      title="Output"
      summary={downstreamReady ? outputSummary : ""}
      open={rightOpen === "output"}
      ontoggle={() => toggleRight("output")}
      disabled={!downstreamReady}
    >
      <Output disabled={!downstreamReady} tracks={tracks.options} />
    </Accordion>
  </div>
</div>

<footer class="action-bar">
  <button type="button" class="btn ghost" disabled={vc.running} onclick={() => vc.clear()}>Clear</button>
  <p class="requirements" class:ok={req.ready} data-testid="requirements" aria-live="polite">{req.message}</p>
  <button type="button" class="btn primary generate" disabled title="Video rendering arrives in the next update.">
    {generateLabel(vc.trackCount)}
  </button>
</footer>

<Modal title="Detect drop start" bind:open={dropDialogOpen}>
  <p>{dropDialogMessage(dropKey ? (vc.fileFor(dropKey)?.name ?? "") : "")}</p>
  <label class="lead-in">
    Start before the drop
    <span class="row">
      <input class="input" type="number" min="0" max="60" step="0.5" bind:value={leadIn} />
      seconds
    </span>
  </label>
  {#snippet actions()}
    <button type="button" class="btn" onclick={() => (dropDialogOpen = false)}>Cancel</button>
    <button type="button" class="btn primary" onclick={analyse}>Analyze</button>
  {/snippet}
</Modal>

<Modal title="Preview unavailable" open={previewError !== null} onclose={() => (previewError = null)}>
  <p>{previewError}</p>
  {#snippet actions()}
    <button type="button" class="btn primary" onclick={() => (previewError = null)}>OK</button>
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
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
  .column {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .zones {
    display: grid;
    gap: 12px;
  }
  .zone {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas: "icon body" "actions actions";
    gap: 10px 14px;
    align-items: center;
    padding: 14px;
    border: 1.5px dashed var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface-sunken);
    transition:
      border-color 0.15s,
      background-color 0.15s;
  }
  @media (min-width: 560px) {
    .zone {
      grid-template-columns: auto minmax(0, 1fr) auto;
      grid-template-areas: "icon body actions";
    }
  }
  .zone.filled {
    border-style: solid;
    border-color: var(--border);
    background: var(--surface);
  }
  .zone.dragging {
    border-color: var(--accent);
    border-style: dashed;
    background: var(--accent-soft);
  }
  .zone-icon {
    grid-area: icon;
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: 12px;
    color: var(--link);
    background: color-mix(in srgb, var(--brand-blue) 18%, transparent);
  }
  .filled .zone-icon {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .thumb {
    grid-area: icon;
    display: grid;
    place-items: center;
    width: 72px;
    height: 72px;
    border-radius: 10px;
    background: var(--surface-sunken);
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .thumb img {
    max-width: 100%;
    max-height: 100%;
  }
  .zone-body {
    grid-area: body;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .zone-title {
    font-weight: 700;
  }
  .zone-file {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .zone-hint {
    color: var(--text-muted);
    font-size: 0.92rem;
  }
  .zone-body .status {
    margin-top: 2px;
  }
  .zone-actions {
    grid-area: actions;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .form {
    display: grid;
    grid-template-columns: minmax(110px, 150px) 1fr;
    gap: 12px 14px;
    align-items: start;
  }
  .label {
    padding-top: 7px;
    font-weight: 600;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    padding-top: 7px;
  }
  .row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  .action-bar {
    position: sticky;
    bottom: 12px;
    z-index: 10;
    display: flex;
    gap: 12px;
    align-items: center;
    margin-top: 18px;
    padding: 10px 12px 10px 10px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: var(--shadow-md);
  }
  .requirements {
    flex: 1;
    margin: 0;
    color: var(--text-muted);
    font-size: 0.93rem;
  }
  .requirements.ok {
    color: var(--ok);
    font-weight: 600;
  }
  .generate {
    min-height: 44px;
    padding: 0 22px;
    border-radius: 12px;
  }
  @media (max-width: 560px) {
    .action-bar {
      flex-wrap: wrap;
    }
    .requirements {
      order: -1;
      flex-basis: 100%;
    }
    .generate {
      flex: 1;
    }
  }
  .lead-in {
    display: grid;
    gap: 6px;
    font-weight: 600;
  }
  .lead-in .row {
    font-weight: 400;
  }
  .lead-in .input {
    width: 100px;
  }
</style>
