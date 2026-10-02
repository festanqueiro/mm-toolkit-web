<script lang="ts">
  import { IMAGE_EXTENSIONS, AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from "../../../engine/media-kind";
  import {
    audioStatus,
    dropDialogMessage,
    durationSummary,
    generateLabel,
    jobSummary,
    requirements,
    trackOptions,
  } from "../../../engine/video-creator";
  import { filesFromDrop, pickFiles } from "../../../io/pick";
  import Accordion from "../../components/Accordion.svelte";
  import Modal from "../../components/Modal.svelte";
  import PageHeader from "../../components/PageHeader.svelte";
  import { routes } from "../../routes";
  import { app } from "../../state.svelte";
  import { vc } from "./state.svelte";
  import TrackTable from "./TrackTable.svelte";

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
  /** Tier 2 exports through Downloads (always available); Tier 1 needs a folder (Output section, next update). */
  const outputOk = $derived(!app.capabilities?.directoryPicker || !!app.settings["general/default_output"]);
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

  // ---- Preview ----
  let previewError = $state<string | null>(null);
  async function preview(key: string) {
    previewError = await vc.togglePreview(key);
  }
</script>

<PageHeader title="Video Creator" {subtitle} />

<div class="columns">
  <div class="column">
    <Accordion title="Input" open={leftOpen === "input"} ontoggle={() => toggleLeft("input")} disabled={vc.running}>
      <div class="form">
        <span class="label" id="audio-label">Audio</span>
        <div
          class="field drop"
          class:dragging={dragTarget === "audio"}
          role="group"
          aria-labelledby="audio-label"
          ondragover={dragOver("audio")}
          ondragleave={() => (dragTarget = null)}
          ondrop={dropAudio}
        >
          <div class="row">
            <input class="input path" readonly aria-labelledby="audio-label" placeholder="Nothing selected" value={vc.audio?.label ?? ""} />
            <button type="button" class="btn" onclick={chooseAudioFile}>Choose File…</button>
            <button type="button" class="btn" onclick={chooseAudioFolder}>Choose Folder…</button>
          </div>
          {#if vc.audio}
            <p class="status" class:ok={musicOk} data-testid="audio-status">{audioStatus(vc.trackCount, true)}</p>
          {/if}
        </div>

        <span class="label" id="visual-label">Image or video</span>
        <div
          class="field drop"
          class:dragging={dragTarget === "visual"}
          role="group"
          aria-labelledby="visual-label"
          ondragover={dragOver("visual")}
          ondragleave={() => (dragTarget = null)}
          ondrop={dropVisual}
        >
          <div class="row">
            <input class="input path" readonly aria-labelledby="visual-label" placeholder="Nothing selected" value={vc.visualFile?.name ?? ""} />
            <button type="button" class="btn" onclick={chooseVisual}>Choose…</button>
          </div>
          <div class="visual">
            {#if vc.visual?.ok}
              <div class="thumb"><img src={vc.visual.thumbnail} alt="Preview of {vc.visualFile?.name}" /></div>
            {/if}
            {#if visualStatus}
              <p class="status" class:ok={vc.visual?.ok} data-testid="visual-status">{visualStatus}</p>
            {/if}
          </div>
        </div>
      </div>
    </Accordion>

    <Accordion
      title="Audio timestamps"
      grow
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
    {#each [["effects", "Visual Effects"], ["layers", "Layers"], ["post", "Post-Effects"]] as const as [key, title] (key)}
      <Accordion {title} open={rightOpen === key} ontoggle={() => toggleRight(key)} disabled={!downstreamReady}>
        <p class="status">Arrives with rendering in the next update.</p>
      </Accordion>
    {/each}
    <Accordion title="Output" open={rightOpen === "output"} ontoggle={() => toggleRight("output")} disabled={!downstreamReady}>
      <div class="form">
        <span class="label">Estimated duration</span>
        <p class="value" data-testid="duration-summary">{durationSummary(tracks.options)}</p>
        <span class="label">Job estimate</span>
        <p class="value" data-testid="job-summary">{jobSummary(tracks.options.length)}</p>
      </div>
    </Accordion>
  </div>
</div>

<footer class="footer">
  <p class="requirements" class:ok={req.ready} data-testid="requirements">{req.message}</p>
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
    gap: 14px;
    align-items: start;
  }
  @media (min-width: 900px) {
    .columns {
      grid-template-columns: 1fr 1fr;
    }
  }
  .column {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .form {
    display: grid;
    grid-template-columns: minmax(110px, 150px) 1fr;
    gap: 14px 14px;
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
  .row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .path {
    flex: 1 1 160px;
  }
  .drop {
    border-radius: 8px;
    outline: 2px dashed transparent;
    outline-offset: 4px;
  }
  .drop.dragging {
    outline-color: var(--accent);
  }
  .visual {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .thumb {
    width: 104px;
    height: 104px;
    flex: none;
    margin-top: 8px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-alt);
  }
  .thumb img {
    max-width: 94px;
    max-height: 94px;
  }
  .value {
    margin: 0;
    padding-top: 7px;
  }
  .footer {
    position: sticky;
    bottom: 0;
    display: flex;
    gap: 12px;
    align-items: center;
    margin-top: 16px;
    padding: 12px 0;
    background: var(--bg);
    border-top: 1px solid var(--border);
  }
  .requirements {
    flex: 1;
    margin: 0;
    color: var(--text-muted);
  }
  .requirements.ok {
    color: var(--ok);
  }
  .generate {
    min-height: 44px;
  }
  .lead-in {
    display: grid;
    gap: 6px;
    font-weight: 600;
  }
  .lead-in .row {
    align-items: center;
    font-weight: 400;
  }
  .lead-in .input {
    width: 100px;
  }
</style>
