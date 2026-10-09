<script lang="ts">
  /**
   * Holds a waveform's place while its peaks load, so the controls below don't jump, with
   * how far the decode is (`progress` 0–1; `null` when that isn't known).
   */
  let { progress = null }: { progress?: number | null } = $props();

  const percent = $derived(progress === null ? undefined : Math.round(Math.min(1, Math.max(0, progress)) * 100));
</script>

<div class="waveform-pending" data-testid="waveform-pending">
  <span class="label">Loading waveform…{percent === undefined ? "" : ` ${percent}%`}</span>
  <progress max="100" value={percent} aria-label="Loading waveform"></progress>
</div>

<style>
  .waveform-pending {
    height: 120px;
    margin-top: 14px;
    padding: 0 16px;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 8px;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    border: 1px solid var(--border);
  }
  .label {
    color: var(--text-muted);
    font-size: 0.88rem;
    font-variant-numeric: tabular-nums;
  }
  progress {
    width: min(100%, 320px);
    height: 8px;
    accent-color: var(--accent);
  }
</style>
