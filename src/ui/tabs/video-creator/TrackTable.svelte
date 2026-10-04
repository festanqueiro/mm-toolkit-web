<script lang="ts">
  import { MAX_TRACK_DURATION, MIN_TRACK_DURATION, previewTooltip } from "../../../engine/video-creator";
  import Icon from "../../Icon.svelte";
  import { vc } from "./state.svelte";

  let { ondetect, onpreview }: { ondetect: (key: string) => void; onpreview: (key: string) => void } = $props();

  const dropDisabled = $derived(vc.analysingKey !== null || vc.running);

  /** QDoubleSpinBox(1–3600, 1 decimal): clamp and round on commit. */
  function commitDuration(key: string, input: HTMLInputElement) {
    const value = Number(input.value);
    const clamped = Number.isFinite(value) ? Math.min(MAX_TRACK_DURATION, Math.max(MIN_TRACK_DURATION, Math.round(value * 10) / 10)) : 60;
    input.value = String(clamped);
    vc.updateRow(key, { duration: clamped });
  }
</script>

<div class="wrap">
  <table>
    <thead>
      <tr>
        <th scope="col">Audio</th>
        <th scope="col">Start</th>
        <th scope="col">Duration</th>
        <th scope="col"><span class="visually-hidden">Preview</span></th>
      </tr>
    </thead>
    <tbody>
      {#each vc.rows as row, index (row.key)}
        <tr
          class:current={vc.rows.length > 1 && index === vc.selectedIndex}
          data-selected={index === vc.selectedIndex}
          onfocusin={() => (vc.selectedKey = row.key)}
          onpointerdown={() => (vc.selectedKey = row.key)}
        >
          <td class="name" title={row.name}>{row.name}</td>
          <td>
            <div class="start">
              <input
                class="input"
                aria-label="Start for track {index + 1}"
                placeholder="HH:MM:SS"
                disabled={vc.running}
                value={row.start}
                oninput={(e) => vc.updateRow(row.key, { start: e.currentTarget.value })}
              />
              <button
                type="button"
                class="btn icon"
                title="Analyze this track and propose a drop start time"
                aria-label="Detect drop for this track"
                disabled={dropDisabled}
                onclick={() => ondetect(row.key)}>✨</button
              >
            </div>
          </td>
          <td>
            <div class="duration">
              <input
                class="input"
                type="number"
                min={MIN_TRACK_DURATION}
                max={MAX_TRACK_DURATION}
                step="0.1"
                aria-label="Duration for track {index + 1} in seconds"
                disabled={vc.running}
                value={row.duration}
                onchange={(e) => commitDuration(row.key, e.currentTarget)}
              />
              <span aria-hidden="true">s</span>
            </div>
          </td>
          <td>
            <button
              type="button"
              class="btn icon flat"
              title={previewTooltip(row)}
              aria-label="{vc.previewKey === row.key ? 'Stop' : 'Play'} preview for {row.name}"
              aria-pressed={vc.previewKey === row.key}
              onclick={() => onpreview(row.key)}
            >
              <Icon name={vc.previewKey === row.key ? "stop" : "play_arrow"} />
            </button>
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
    background: var(--surface-alt);
    text-align: left;
    font-weight: 650;
    font-size: 0.85rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 9px 10px;
  }
  td {
    padding: 6px 10px;
    vertical-align: middle;
  }
  tbody tr {
    box-shadow: inset 3px 0 0 transparent;
  }
  tbody tr:nth-child(even) {
    background: var(--surface-alt);
  }
  /* The track on the waveform and in the preview (only marked when there is a choice). */
  tbody tr.current {
    background: var(--accent-soft);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .name {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .start {
    display: flex;
    gap: 4px;
  }
  .start .input {
    width: 100px;
  }
  .duration {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .duration .input {
    width: 84px;
  }
  .flat {
    background: none;
    border-color: transparent;
  }
  /* Phones: each row becomes a two-line card (name, then start / duration / preview). */
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
      grid-template-columns: 1fr auto auto;
      align-items: center;
      padding: 4px 0;
    }
    td.name {
      grid-column: 1 / -1;
      max-width: none;
      font-weight: 600;
      padding-bottom: 0;
    }
    .start .input {
      width: 92px;
    }
    .duration .input {
      width: 70px;
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
