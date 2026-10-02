<script lang="ts">
  import {
    AUDIO_BITRATES,
    durationSummary,
    jobSummary,
    MAX_FPS,
    MIN_FPS,
    OUTPUT_STATUS,
    PROFILES,
    QUALITIES,
    reallowFolder,
    type TrackOption,
  } from "../../../engine/video-creator";
  import { app } from "../../state.svelte";
  import { vc } from "./state.svelte";

  let { disabled = false, tracks }: { disabled?: boolean; tracks: TrackOption[] } = $props();

  const tier1 = $derived(app.capabilities?.directoryPicker ?? false);

  function commitFps(input: HTMLInputElement) {
    const value = Math.round(Number(input.value));
    vc.fps = Number.isFinite(value) ? Math.min(MAX_FPS, Math.max(MIN_FPS, value)) : 24;
    input.value = String(vc.fps);
  }
</script>

<div class="form">
  <span class="label" id="export-label">Export folder</span>
  <div class="field">
    {#if tier1}
      <div class="row">
        <input class="input path" readonly aria-labelledby="export-label" placeholder="Nothing selected" value={vc.output?.name ?? ""} />
        <button type="button" class="btn" {disabled} onclick={() => vc.chooseOutput()}>Choose…</button>
      </div>
      {#if vc.output}
        {#if vc.outputPermission === "granted"}
          <p class="status ok" data-testid="output-status">{OUTPUT_STATUS.writable}</p>
        {:else if vc.outputPermission === "prompt"}
          <p class="status" data-testid="output-status">
            <button type="button" class="link" onclick={() => vc.reallowOutput()}>{reallowFolder(vc.output.name)}</button>
          </p>
        {:else}
          <p class="status warn" data-testid="output-status">{OUTPUT_STATUS.notWritable}</p>
        {/if}
      {/if}
    {:else}
      <p class="status value" data-testid="output-status">{OUTPUT_STATUS.downloads}</p>
    {/if}
  </div>

  <label class="label" for="video-profile">Video profile</label>
  <div class="field">
    <select id="video-profile" class="input" {disabled} bind:value={vc.profile}>
      {#each PROFILES as profile, i (profile.label)}
        <option value={i}>{profile.label}</option>
      {/each}
    </select>
  </div>

  <label class="label" for="frame-rate">Frame rate</label>
  <div class="field">
    <input id="frame-rate" class="input narrow" type="number" min={MIN_FPS} max={MAX_FPS} step="1" {disabled} value={vc.fps} onchange={(e) => commitFps(e.currentTarget)} />
  </div>

  <label class="label" for="quality">Quality</label>
  <div class="field">
    <select id="quality" class="input" {disabled} bind:value={vc.quality}>
      {#each QUALITIES as quality (quality.value)}
        <option value={quality.value}>{quality.label}</option>
      {/each}
    </select>
  </div>

  <label class="label" for="audio-bitrate">Audio bitrate</label>
  <div class="field">
    <select id="audio-bitrate" class="input" {disabled} bind:value={vc.audioBitrate}>
      {#each AUDIO_BITRATES as bitrate (bitrate)}
        <option value={bitrate}>{bitrate}</option>
      {/each}
    </select>
  </div>

  <span class="label">Estimated duration</span>
  <p class="value" data-testid="duration-summary">{durationSummary(tracks)}</p>
  <span class="label">Job estimate</span>
  <p class="value" data-testid="job-summary">{jobSummary(tracks.length)}</p>
</div>

<style>
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
  .row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .path {
    flex: 1 1 140px;
  }
  select.input {
    min-width: 200px;
  }
  .narrow {
    width: 90px;
  }
  .value {
    margin: 0;
    padding-top: 7px;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    text-decoration: underline;
    font: inherit;
    cursor: pointer;
  }
</style>
