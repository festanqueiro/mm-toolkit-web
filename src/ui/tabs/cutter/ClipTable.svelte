<script lang="ts">
  import { defaultClipTitle, type ClipRow } from "../../../engine/clips";
  import Icon from "../../Icon.svelte";
  import { cutter } from "./state.svelte";

  /** `onedit`: a row's timing changed (stops its clip preview). */
  let { previewKey, onpreview, onedit, disabled = false }: { previewKey: string | null; onpreview: (key: string) => void; onedit: (key: string) => void; disabled?: boolean } =
    $props();

  function edit(key: string, field: keyof Omit<ClipRow, "key">, value: string) {
    cutter.updateRow(key, { [field]: value });
    if (field !== "title") onedit(key);
  }
</script>

<div class="wrap">
  <table>
    <thead>
      <tr>
        <th scope="col">Title</th>
        <th scope="col">Start</th>
        <th scope="col">End</th>
        <th scope="col">Duration</th>
        <th scope="col"><span class="visually-hidden">Actions</span></th>
      </tr>
    </thead>
    <tbody>
      {#each cutter.rows as row, index (row.key)}
        <tr class:current={row.key === cutter.currentKey} onfocusin={() => (cutter.currentKey = row.key)}>
          <td class="title">
            <input class="input" aria-label="Title for clip {index + 1}" placeholder={defaultClipTitle(index)} value={row.title} {disabled} oninput={(e) => edit(row.key, "title", e.currentTarget.value)} />
          </td>
          <td class="start">
            <input
              class="input time"
              aria-label="Start for clip {index + 1}"
              placeholder="Required, e.g. 00:03:15"
              title="Required, e.g. 00:03:15"
              value={row.start}
              {disabled}
              oninput={(e) => edit(row.key, "start", e.currentTarget.value)}
            />
          </td>
          <td class="end">
            <input class="input time" aria-label="End for clip {index + 1}" placeholder="Optional" value={row.end} {disabled} oninput={(e) => edit(row.key, "end", e.currentTarget.value)} />
          </td>
          <td class="dur">
            <input
              class="input duration"
              aria-label="Duration for clip {index + 1}"
              placeholder="60"
              value={row.duration}
              {disabled}
              oninput={(e) => edit(row.key, "duration", e.currentTarget.value)}
            />
          </td>
          <td class="acts">
            <div class="row-actions">
              <button
                type="button"
                class="btn icon flat"
                title="Play this clip"
                aria-label="{previewKey === row.key ? 'Stop' : 'Play'} clip {index + 1}"
                aria-pressed={previewKey === row.key}
                onclick={() => onpreview(row.key)}
              >
                <Icon name={previewKey === row.key ? "stop" : "play_arrow"} />
              </button>
              <button type="button" class="btn icon flat" title="Remove this clip" aria-label="Remove clip {index + 1}" {disabled} onclick={() => cutter.removeRow(row.key)}>
                <Icon name="delete" />
              </button>
            </div>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .wrap {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    overflow: auto;
    max-height: 420px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface-alt);
    text-align: left;
    font-weight: 650;
    font-size: 0.85rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 9px 8px;
  }
  td {
    padding: 6px 4px;
    vertical-align: middle;
  }
  td:first-child {
    padding-left: 8px;
  }
  tbody tr {
    box-shadow: inset 3px 0 0 transparent;
  }
  tbody tr:nth-child(even) {
    background: var(--surface-alt);
  }
  tbody tr.current {
    background: var(--accent-soft);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .title .input {
    width: 100%;
    min-width: 90px;
  }
  .time {
    width: 96px;
  }
  .duration {
    width: 64px;
  }
  .row-actions {
    display: flex;
    gap: 2px;
  }
  .flat {
    background: none;
    border-color: transparent;
  }
  /* Phones: each row becomes a card: title + actions, then start / end / duration. */
  @media (max-width: 560px) {
    thead {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    tr {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 80px;
      grid-template-areas: "title title acts" "start end dur";
      align-items: center;
      padding: 4px 4px 4px 0;
    }
    td.title {
      grid-area: title;
    }
    td.start {
      grid-area: start;
      padding-left: 8px;
    }
    td.end {
      grid-area: end;
    }
    td.dur {
      grid-area: dur;
    }
    td.acts {
      grid-area: acts;
    }
    .time,
    .duration {
      width: 100%;
    }
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
