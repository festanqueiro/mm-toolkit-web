<script lang="ts">
  import { MP3_BITRATES } from "../../../engine/converter";
  import { reselectHint } from "../../../engine/history";
  import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from "../../../engine/media-kind";
  import { STEM_CHOICES, STEM_FORMATS, STEM_HINTS, STEM_LABELS, STEM_MESSAGES, stemRequirements, stemsStatus } from "../../../engine/stems/rules";
  import { pickFiles } from "../../../io/pick";
  import Icon from "../../Icon.svelte";
  import DropZone from "../../components/DropZone.svelte";
  import ExportFolder from "../../components/ExportFolder.svelte";
  import JobFooter from "../../components/JobFooter.svelte";
  import Modal from "../../components/Modal.svelte";
  import PageHeader from "../../components/PageHeader.svelte";
  import Section from "../../components/Section.svelte";
  import { openHistory } from "../../history.svelte";
  import { routes } from "../../routes";
  import { app } from "../../state.svelte";
  import { stemSplitter as st } from "./state.svelte";

  $effect(() => {
    if (app.settingsLoaded) st.restore();
  });

  // Desktop-style guard: separation takes minutes; ask before leaving the page.
  $effect(() => {
    if (!st.running) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  });

  const subtitle = routes.find((r) => r.path === "stems")!.subtitle;
  const accept = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS].join(",");
  const sourceOk = $derived(st.source?.ok === true);
  const req = $derived(stemRequirements({ sourceOk, stems: st.stems.length, outputOk: st.folder.ok, running: st.running }));

  async function choose() {
    const picked = await pickFiles({ accept });
    if (picked.files[0]) await st.setSource(picked.files[0].file);
  }
  async function drop(transfer: DataTransfer) {
    const file = transfer.files[0];
    if (file) await st.setSource(file);
  }

  // Inline players for the finished stems.
  let urls = $state<Record<string, string>>({});
  $effect(() => {
    const results = st.results;
    let live = true;
    const made: Record<string, string> = {};
    void (async () => {
      for (const result of results) made[result.name] = URL.createObjectURL(await result.open());
      if (live) urls = made;
    })();
    return () => {
      live = false;
      for (const url of Object.values(made)) URL.revokeObjectURL(url);
      urls = {};
    };
  });
</script>

<PageHeader title="Stem Splitter" {subtitle} icon="graphic_eq" />

<div class="columns">
  <div class="column">
    <Section title="Input">
      <DropZone title="Source audio" filled={sourceOk} disabled={st.running} ondropped={drop}>
        {#snippet icon()}<span class="tile" aria-hidden="true"><Icon name="graphic_eq" size={26} /></span>{/snippet}
        {#if st.source}
          <span class="zone-file" title={st.source.file.name}>{st.source.file.name}</span>
          <p class="status" class:ok={sourceOk} class:warn={!st.source.checking && !sourceOk} data-testid="source-status">
            {st.source.checking ? "Checking…" : st.source.message}
          </p>
        {:else}
          <span class="zone-hint" class:reselect={st.pendingSource} data-testid="source-hint">{st.pendingSource ? reselectHint([st.pendingSource]) : "Drop a song (audio or video) here"}</span>
        {/if}
        {#snippet actions()}
          <button type="button" class="btn" disabled={st.running} onclick={choose}>Choose…</button>
        {/snippet}
      </DropZone>
      <p class="model" data-testid="model-status">
        {st.modelReady ? STEM_MESSAGES.modelReady : STEM_MESSAGES.modelPending}
      </p>
    </Section>

    {#if st.results.length}
      <Section title="Stems">
        <ul class="results" aria-label="Stems">
          {#each st.results as result (result.name)}
            <li>
              <span class="name" title={result.name}>{result.name}</span>
              {#if urls[result.name]}
                <audio src={urls[result.name]} controls preload="metadata" aria-label="Play {result.name}"></audio>
              {/if}
            </li>
          {/each}
        </ul>
      </Section>
    {/if}
  </div>

  <div class="column">
    <Section title="Stems to export">
      <fieldset class="stems" disabled={st.running}>
        <legend class="visually-hidden">Stems to export</legend>
        {#each STEM_CHOICES as stem (stem)}
          <label class="check">
            <input type="checkbox" checked={st.stems.includes(stem)} onchange={(e) => st.toggleStem(stem, e.currentTarget.checked)} />
            <span>{STEM_LABELS[stem]}{#if STEM_HINTS[stem]}<span class="hint"> ({STEM_HINTS[stem]})</span>{/if}</span>
          </label>
        {/each}
      </fieldset>
      <p class="status" class:ok={st.stems.length > 0} class:warn={!st.stems.length} data-testid="stems-status">{stemsStatus(st.stems.length)}</p>

      <div class="form">
        <label class="label" for="stem-format">Output format</label>
        <div class="field">
          <select id="stem-format" class="input" disabled={st.running} bind:value={st.format}>
            {#each STEM_FORMATS as format (format)}
              <option value={format}>{format.toUpperCase()}</option>
            {/each}
          </select>
        </div>
        {#if st.format === "mp3"}
          <label class="label" for="stem-bitrate">MP3 bitrate</label>
          <div class="field">
            <select id="stem-bitrate" class="input" disabled={st.running} bind:value={st.bitrate}>
              {#each MP3_BITRATES as bitrate (bitrate)}
                <option value={bitrate}>{parseInt(bitrate, 10)} kbps</option>
              {/each}
            </select>
          </div>
        {/if}
        <span class="label" id="stems-export-label">Export folder</span>
        <div class="field">
          <ExportFolder folder={st.folder} disabled={st.running} downloads="Stems are saved to your browser's Downloads folder." labelId="stems-export-label" />
        </div>
      </div>
    </Section>
  </div>
</div>

<JobFooter
  progress={st.progress}
  running={st.running}
  cancelling={st.cancelling}
  warnings={st.warnings}
  requirement={req}
  label="Split Stems"
  progressLabel="Stem splitting progress"
  onclear={() => st.clear()}
  oncancel={() => st.cancel()}
  onstart={() => st.split()}
  onstatus={st.lastJobId && !st.running ? () => openHistory(st.lastJobId) : null}
/>

<Modal title="Stem splitting failed" open={st.failure !== null} onclose={() => (st.failure = null)}>
  <p>{st.failure?.message}</p>
  {#if st.failure?.details}
    <details>
      <summary>Details</summary>
      <pre>{st.failure.details}</pre>
    </details>
  {/if}
  {#snippet actions()}
    <button type="button" class="btn primary" onclick={() => (st.failure = null)}>OK</button>
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
  .model {
    margin: 12px 0 0;
    color: var(--text-muted);
    font-size: 0.92rem;
  }
  .stems {
    display: grid;
    gap: 8px;
    margin: 0 0 6px;
    padding: 0;
    border: 0;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .hint {
    color: var(--text-muted);
  }
  .form {
    display: grid;
    grid-template-columns: minmax(110px, 150px) 1fr;
    gap: 12px 14px;
    align-items: start;
    margin-top: 14px;
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
  select.input {
    min-width: 200px;
  }
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .results li {
    display: grid;
    gap: 4px;
  }
  .results .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .results audio {
    width: 100%;
  }
  pre {
    max-height: 200px;
    overflow: auto;
    font-size: 0.8rem;
    white-space: pre-wrap;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
