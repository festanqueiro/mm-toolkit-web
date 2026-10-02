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
    type TrackOption,
  } from "../../../engine/video-creator";
  import ExportFolder from "../../components/ExportFolder.svelte";
  import { vc } from "./state.svelte";

  let { disabled = false, tracks }: { disabled?: boolean; tracks: TrackOption[] } = $props();

  function commitFps(input: HTMLInputElement) {
    const value = Math.round(Number(input.value));
    vc.fps = Number.isFinite(value) ? Math.min(MAX_FPS, Math.max(MIN_FPS, value)) : 24;
    input.value = String(vc.fps);
  }
</script>

<div class="form">
  <span class="label" id="export-label">Export folder</span>
  <div class="field">
    <ExportFolder folder={vc.folder} {disabled} downloads={OUTPUT_STATUS.downloads} />
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
  @container rail (max-width: 420px) {
    .form {
      grid-template-columns: 1fr;
      gap: 6px;
    }
    select.input {
      min-width: 0;
      width: 100%;
    }
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
  .narrow {
    width: 90px;
  }
  .value {
    margin: 0;
    padding-top: 7px;
  }
</style>
