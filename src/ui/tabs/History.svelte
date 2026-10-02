<script lang="ts">
  import { untrack } from "svelte";
  import { HISTORY_STATUS, historyItemLabel, historyKey, type HistoryTool } from "../../engine/history";
  import { mediaKind } from "../../engine/media-kind";
  import { reallowFolder } from "../../engine/video-creator";
  import { requestPermission, handleFor } from "../../io/file-ref";
  import { resolveOutputs, type OutputLookup } from "../../io/history-outputs";
  import { removeStagedJobs } from "../../io/sink";
  import { clearHistory, listHistory, type HistoryRecord } from "../../storage/history";
  import Icon from "../Icon.svelte";
  import Modal from "../components/Modal.svelte";
  import PageHeader from "../components/PageHeader.svelte";
  import Section from "../components/Section.svelte";
  import { historySeen, historyUi } from "../history.svelte";
  import { loadJob } from "../load-job";
  import { routes } from "../routes";

  const subtitle = routes.find((r) => r.path === "history")!.subtitle;

  let records = $state<HistoryRecord[]>([]);
  let selected = $state<HistoryRecord | null>(null);
  let lookup = $state<OutputLookup | null>(null);
  let looking = $state(false);
  let chosen = $state<string | null>(null);
  let preview = $state<{ name: string; url: string; video: boolean } | null>(null);
  let previewError = $state(false);
  let confirmClear = $state(false);
  let deleteCopies = $state(true);

  // Opening History marks everything as seen.
  $effect(() => {
    historySeen();
  });

  // Reload when a job finishes (or on first open); keep the selection when it still exists.
  $effect(() => {
    void historyUi.revision;
    untrack(() => void refresh());
  });

  async function refresh() {
    const previousKey = selected ? historyKey(selected) : null;
    try {
      records = await listHistory();
    } catch {
      records = [];
    }
    const wanted =
      records.find((r) => r.id === historyUi.selectedId) ?? (previousKey ? records.find((r) => historyKey(r) === previousKey) : undefined) ?? records[0] ?? null;
    historyUi.selectedId = null;
    if (wanted?.id !== selected?.id || !lookup) await select(wanted);
  }

  async function select(record: HistoryRecord | null) {
    selected = record;
    closePreview();
    chosen = null;
    lookup = null;
    if (!record) return;
    looking = true;
    try {
      const found = await resolveOutputs(record);
      if (selected?.id === record.id) lookup = found;
    } finally {
      if (selected?.id === record.id) looking = false;
    }
  }

  async function reallow() {
    if (!lookup?.folder) return;
    const handle = await handleFor<FileSystemDirectoryHandle>(lookup.folder.ref);
    if (handle && (await requestPermission(handle, "read"))) await select(selected);
  }

  async function open(name: string) {
    const file = lookup?.files.find((f) => f.name === name);
    if (!file) return;
    chosen = name;
    closePreview();
    const blob = await file.open();
    preview = { name, url: URL.createObjectURL(blob), video: mediaKind(name) === "video" };
  }

  function closePreview() {
    if (preview) URL.revokeObjectURL(preview.url);
    preview = null;
    previewError = false;
  }
  $effect(() => closePreview);

  async function download(names: string[]) {
    for (const name of names) {
      const file = lookup?.files.find((f) => f.name === name);
      if (!file) continue;
      const url = URL.createObjectURL(await file.open());
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }

  async function clearAll() {
    confirmClear = false;
    const ids = records.map((r) => r.id);
    await clearHistory().catch(() => {});
    if (deleteCopies) await removeStagedJobs(ids).catch(() => {});
    selected = null;
    lookup = null;
    closePreview();
    records = [];
  }

  const status = $derived(
    !selected
      ? HISTORY_STATUS.select
      : looking
        ? "Checking…"
        : lookup && !lookup.files.length && !(lookup.folder && lookup.folder.permission === "prompt")
          ? HISTORY_STATUS.none
          : "",
  );
</script>

<PageHeader title="History" {subtitle} icon="history" />

<div class="columns">
  <Section title="Jobs">
    {#if records.length}
      <ul class="jobs" role="listbox" aria-label="Jobs">
        {#each records as record (record.id)}
          <li role="option" aria-selected={selected?.id === record.id}>
            <button type="button" class:current={selected?.id === record.id} onclick={() => select(record)}>{historyItemLabel(record as { created: string; tool: HistoryTool; source?: unknown })}</button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty">Finished jobs appear here. They're stored only in this browser.</p>
    {/if}
    <div class="row">
      <button type="button" class="btn ghost" disabled={!records.length} onclick={() => (confirmClear = true)}>Clear History</button>
      <span class="grow"></span>
      <button type="button" class="btn primary" disabled={!selected} onclick={() => selected && loadJob(selected)}>Load Job</button>
    </div>
  </Section>

  <Section title="Rendered files">
    {#if lookup?.folder && lookup.folder.permission === "prompt"}
      <p class="status">
        <button type="button" class="link" onclick={reallow}>{reallowFolder(lookup.folder.ref.name)}</button>
      </p>
    {/if}
    {#if lookup?.files.length}
      <ul class="outputs" aria-label="Rendered files">
        {#each lookup.files as file (file.name)}
          <li>
            <button type="button" class:current={chosen === file.name} title={file.name} onclick={() => open(file.name)}>
              <Icon name={mediaKind(file.name) === "video" ? "movie" : "audiotrack"} size={18} />
              <span class="name">{file.name}</span>
            </button>
          </li>
        {/each}
      </ul>
      <div class="row">
        <button type="button" class="btn" disabled={!chosen} onclick={() => chosen && download([chosen])}>Download</button>
        <button type="button" class="btn" onclick={() => download(lookup!.files.map((f) => f.name))}>Download all</button>
      </div>
    {/if}
    {#if preview}
      <div class="preview">
        {#if previewError}
          <p class="status warn">This browser can't preview {preview.name}.</p>
        {:else if preview.video}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={preview.url} controls playsinline onerror={() => (previewError = true)}></video>
        {:else}
          <audio src={preview.url} controls onerror={() => (previewError = true)}></audio>
        {/if}
      </div>
    {/if}
    {#if status}
      <p class="status" data-testid="history-status" aria-live="polite">{status}</p>
    {/if}
  </Section>
</div>

<Modal title="Clear History" bind:open={confirmClear}>
  <p>Remove every job from History? Files you exported aren't touched.</p>
  <label class="check"><input type="checkbox" bind:checked={deleteCopies} /> Also delete copies kept for History</label>
  {#snippet actions()}
    <button type="button" class="btn" onclick={() => (confirmClear = false)}>Cancel</button>
    <button type="button" class="btn primary" onclick={clearAll}>Clear History</button>
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
  .jobs,
  .outputs {
    list-style: none;
    margin: 0;
    padding: 4px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .jobs {
    max-height: 420px;
  }
  .outputs {
    max-height: 160px;
  }
  .jobs button,
  .outputs button {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
    min-width: 0;
    padding: 8px 10px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    white-space: pre;
    cursor: pointer;
  }
  .jobs button:hover,
  .outputs button:hover {
    background: var(--surface-alt);
  }
  .jobs button.current,
  .outputs button.current {
    background: var(--accent-soft);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .jobs button {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    margin: 0;
    color: var(--text-muted);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-top: 12px;
  }
  .grow {
    flex: 1;
  }
  .preview {
    margin-top: 12px;
  }
  .preview video {
    display: block;
    width: 100%;
    max-height: 320px;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
  }
  .preview audio {
    width: 100%;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--link);
    text-decoration: underline;
    font: inherit;
    cursor: pointer;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  @media (max-width: 560px) {
    .jobs button {
      white-space: normal;
    }
  }
</style>
