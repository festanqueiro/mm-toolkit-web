<script lang="ts">
  import {
    CONVERTER_DOWNLOADS,
    convertRequirements,
    detectedLabel,
    formatsFor,
    inputStatus,
    MP3_BITRATES,
    UNAVAILABLE_FORMATS,
  } from "../../../engine/converter";
  import { reselectHint } from "../../../engine/history";
  import { AUDIO_EXTENSIONS, mediaKind, VIDEO_EXTENSIONS } from "../../../engine/media-kind";
  import { filesFromDrop, pickFiles } from "../../../io/pick";
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
  import { converter } from "./state.svelte";

  $effect(() => {
    if (app.settingsLoaded) converter.restore();
  });

  // Desktop blocks closing while converting; the web asks before leaving the page.
  $effect(() => {
    if (!converter.running) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  });

  const subtitle = routes.find((r) => r.path === "converter")!.subtitle;
  const accept = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS].join(",");

  const batch = $derived(converter.batch);
  const kind = $derived("kind" in batch ? batch.kind : null);
  const batchOk = $derived(kind !== null);
  const formats = $derived(formatsFor(kind));
  const req = $derived(
    convertRequirements({ batch, outputOk: converter.folder.ok, running: converter.running, format: converter.format, bitrate: converter.bitrate }),
  );

  async function choose() {
    const picked = await pickFiles({ accept, multiple: true });
    if (picked.files.length) converter.add(picked.files.map((p) => p.file));
  }
  async function drop(transfer: DataTransfer) {
    const picked = await filesFromDrop(transfer);
    if (picked.files.length) converter.add(picked.files.map((p) => p.file));
  }

  // ---- Preview Selected (inline; desktop opened the OS player) ----
  let preview = $state<{ name: string; url: string; video: boolean } | null>(null);
  let previewError = $state(false);
  function previewSelected() {
    const entry = converter.files.find((f) => converter.selected.includes(f.key));
    closePreview();
    if (!entry) return;
    preview = { name: entry.file.name, url: URL.createObjectURL(entry.file), video: mediaKind(entry.file.name) === "video" };
  }
  function closePreview() {
    if (preview) URL.revokeObjectURL(preview.url);
    preview = null;
    previewError = false;
  }
  $effect(() => closePreview);
</script>

<ToolLayout title="Media Converter" {subtitle} icon="swap_horiz">
  {#snippet setup()}
    <SetupSection title="Files">
      <DropZone title="Audio or video files" filled={batchOk} disabled={converter.running} ondropped={drop}>
        {#snippet icon()}<span class="tile" aria-hidden="true"><Icon name="swap_horiz" size={26} /></span>{/snippet}
        {#if converter.files.length}
          <span class="zone-file">{converter.files.length} file{converter.files.length === 1 ? "" : "s"}</span>
        {:else}
          <span class="zone-hint" class:reselect={converter.pendingNames.length} data-testid="files-hint">{converter.pendingNames.length ? reselectHint(converter.pendingNames) : "Drop audio or video files here"}</span>
        {/if}
        {#snippet actions()}
          <button type="button" class="btn" disabled={converter.running} onclick={choose}>Choose Audio or Video Files…</button>
        {/snippet}
      </DropZone>

      {#if converter.files.length}
        <ul class="files" aria-label="Files to convert">
          {#each converter.files as entry (entry.key)}
            <li class:bad={entry.ok === false}>
              <label title={entry.file.name}>
                <input type="checkbox" value={entry.key} bind:group={converter.selected} disabled={converter.running} />
                <span class="name">{entry.file.name}</span>
                {#if entry.ok === false}<span class="tag">can't be used</span>{/if}
              </label>
            </li>
          {/each}
        </ul>
        <div class="row">
          <button type="button" class="btn" disabled={!converter.selected.length || converter.running} onclick={() => converter.removeSelected()}>Remove Selected</button>
          <button type="button" class="btn" disabled={!converter.selected.length} onclick={previewSelected}>
            <Icon name="play_arrow" size={18} /> Preview Selected
          </button>
        </div>
      {/if}

      {#if preview}
        <div class="preview">
          <div class="preview-head">
            <span class="name" title={preview.name}>{preview.name}</span>
            <button type="button" class="btn ghost" onclick={closePreview}>Close</button>
          </div>
          {#if previewError}
            <p class="status warn">This browser can't preview {preview.name}. It can still be converted.</p>
          {:else if preview.video}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video src={preview.url} controls playsinline onerror={() => (previewError = true)}></video>
          {:else}
            <audio src={preview.url} controls onerror={() => (previewError = true)}></audio>
          {/if}
        </div>
      {/if}

      {#if inputStatus(batch)}
        <p class="status" class:ok={batchOk} class:warn={"error" in batch && batch.error !== "checking"} data-testid="input-status" aria-live="polite">
          {inputStatus(batch)}
        </p>
      {/if}
    </SetupSection>
  {/snippet}

  {#snippet rail()}
    <RailBlock title="Export">
      <div class="stack">
        <div class="field-row">
          <span class="label">Detected media</span>
          <p class="value" data-testid="detected">{detectedLabel(batch)}</p>
        </div>
        <label class="label" for="convert-to">Convert to</label>
        <select id="convert-to" class="input" disabled={!batchOk || converter.running} bind:value={converter.format}>
          {#each formats as format (format)}
            <option value={format} disabled={!!UNAVAILABLE_FORMATS[format]} title={UNAVAILABLE_FORMATS[format] ?? ""}>
              {format.toUpperCase()}{UNAVAILABLE_FORMATS[format] ? " (not available)" : ""}
            </option>
          {/each}
        </select>
        {#if kind === "video" && formats.some((f) => UNAVAILABLE_FORMATS[f])}
          <p class="status hint">{UNAVAILABLE_FORMATS.avi}</p>
        {/if}
        {#if converter.format === "ogg"}
          <p class="status hint">OGG files use the Opus codec.</p>
        {/if}
        {#if kind === "audio" && converter.format === "mp3"}
          <label class="label" for="mp3-bitrate">MP3 bitrate</label>
          <select id="mp3-bitrate" class="input" disabled={converter.running} bind:value={converter.bitrate}>
            {#each MP3_BITRATES as bitrate (bitrate)}
              <option value={bitrate}>{parseInt(bitrate, 10)} kbps</option>
            {/each}
          </select>
        {/if}
        <span class="label" id="converter-export-label">Export folder</span>
        <ExportFolder folder={converter.folder} disabled={converter.running} downloads={CONVERTER_DOWNLOADS} labelId="converter-export-label" />
      </div>
    </RailBlock>
  {/snippet}

  {#snippet action()}
    <RailAction
      progress={converter.progress}
      running={converter.running}
      cancelling={converter.cancelling}
      warnings={converter.warnings}
      requirement={req}
      label="Convert Files"
      progressLabel="Conversion progress"
      onstatus={converter.lastJobId && !converter.running ? () => openHistory(converter.lastJobId) : null}
      onclear={() => {
        closePreview();
        converter.clear();
      }}
      oncancel={() => converter.cancel()}
      onstart={() => converter.convert()}
    />
  {/snippet}

  {#snippet after()}
    <RailError title="Conversion failed" failure={converter.failure} ondismiss={() => (converter.failure = null)} />
    <RailResults results={converter.results} savedTo={converter.savedTo} historyId={converter.lastJobId} />
  {/snippet}
</ToolLayout>

<style>
  .stack {
    display: grid;
    gap: 8px;
  }
  .stack .label {
    font-weight: 600;
    margin-top: 4px;
  }
  .field-row {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .value {
    margin: 0;
  }
  .stack select.input {
    width: 100%;
  }
  .files {
    list-style: none;
    margin: 14px 0 0;
    padding: 4px;
    max-height: 260px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .files li {
    border-radius: 6px;
  }
  .files li:nth-child(even) {
    background: var(--surface-alt);
  }
  .files label {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 6px 8px;
    min-width: 0;
    cursor: pointer;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bad .name {
    color: var(--text-muted);
  }
  .tag {
    flex: none;
    font-size: 0.8rem;
    color: var(--warn);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
  .row .btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .preview {
    margin-top: 14px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
  }
  .preview-head {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 8px;
    font-weight: 600;
  }
  .preview video {
    display: block;
    width: 100%;
    max-height: 280px;
    background: var(--surface-sunken);
  }
  .preview audio {
    width: 100%;
  }
  .label {
    padding-top: 7px;
    font-weight: 600;
  }
  .hint {
    color: var(--text-muted);
  }
</style>
