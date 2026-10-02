<script lang="ts">
  import { MP3_BITRATES } from "../../../engine/converter";
  import { reselectHint } from "../../../engine/history";
  import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from "../../../engine/media-kind";
  import { STEM_CHOICES, STEM_FORMATS, STEM_HINTS, STEM_LABELS, STEM_MESSAGES, stemRequirements, stemsStatus } from "../../../engine/stems/rules";
  import { pickFiles } from "../../../io/pick";
  import Icon from "../../Icon.svelte";
  import DropZone from "../../components/DropZone.svelte";
  import ExportFolder from "../../components/ExportFolder.svelte";
  import RailAction from "../../components/RailAction.svelte";
  import RailBlock from "../../components/RailBlock.svelte";
  import RailError from "../../components/RailError.svelte";
  import RailResults from "../../components/RailResults.svelte";
  import SetupSection from "../../components/SetupSection.svelte";
  import ToolLayout from "../../components/ToolLayout.svelte";
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
</script>

<ToolLayout title="Stem Splitter" {subtitle} icon="graphic_eq">
  {#snippet setup()}
    <SetupSection title="Source">
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

    
    </SetupSection>
    <SetupSection title="Stems to export">
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

      
    </SetupSection>
  {/snippet}

  {#snippet rail()}
    <RailBlock title="Export">
      <div class="stack">
  <p class="model" data-testid="model-status">
        {st.modelReady ? STEM_MESSAGES.modelReady : STEM_MESSAGES.modelPending}
      </p>
        <label class="label" for="stem-format">Output format</label>
        <select id="stem-format" class="input" disabled={st.running} bind:value={st.format}>
          {#each STEM_FORMATS as format (format)}
            <option value={format}>{format.toUpperCase()}</option>
          {/each}
        </select>
        {#if st.format === "mp3"}
          <label class="label" for="stem-bitrate">MP3 bitrate</label>
          <select id="stem-bitrate" class="input" disabled={st.running} bind:value={st.bitrate}>
            {#each MP3_BITRATES as bitrate (bitrate)}
              <option value={bitrate}>{parseInt(bitrate, 10)} kbps</option>
            {/each}
          </select>
        {/if}
        <span class="label" id="stems-export-label">Export folder</span>
        <ExportFolder folder={st.folder} disabled={st.running} downloads="Stems are saved to your browser's Downloads folder." labelId="stems-export-label" />
      </div>
    </RailBlock>
  {/snippet}

  {#snippet action()}
    <RailAction
      progress={st.progress}
      running={st.running}
      cancelling={st.cancelling}
      warnings={st.warnings}
      requirement={req}
      label="Split Stems"
      progressLabel="Stem splitting progress"
      onstatus={st.lastJobId && !st.running ? () => openHistory(st.lastJobId) : null}
      onclear={() => st.clear()}
      oncancel={() => st.cancel()}
      onstart={() => st.split()}
    />
  {/snippet}

  {#snippet after()}
    <RailError title="Stem splitting failed" failure={st.failure} ondismiss={() => (st.failure = null)} />
    <RailResults results={st.results} savedTo={st.savedTo} historyId={st.lastJobId} />
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
  .stack select.input {
    width: 100%;
  }
  .model {
    margin: 0 0 4px;
    color: var(--text-muted);
    font-size: 0.9rem;
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
    margin-left: 0.3em;
    color: var(--text-muted);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
