<script lang="ts">
  /** The sticky footer of a tool: progress + warnings, then Clear · Cancel · requirements · primary action. */
  let {
    progress,
    running,
    cancelling,
    warnings,
    requirement,
    label,
    progressLabel,
    onclear,
    oncancel,
    onstart,
  }: {
    progress: { percent: number; status: string } | null;
    running: boolean;
    cancelling: boolean;
    warnings: string[];
    requirement: { ready: boolean; message: string };
    label: string;
    progressLabel: string;
    onclear: () => void;
    oncancel: () => void;
    onstart: () => void;
  } = $props();
</script>

<footer class="action-bar">
  {#if progress}
    <div class="progress-row">
      <p class="progress-status" data-testid="progress-status" aria-live="polite">{progress.status}</p>
      {#if running}
        <progress max="100" value={progress.percent} aria-label={progressLabel}>{progress.percent}%</progress>
      {/if}
    </div>
  {/if}
  {#each warnings as warning (warning)}
    <p class="status warn progress-row">{warning}</p>
  {/each}
  <div class="actions">
    <button type="button" class="btn ghost" disabled={running} onclick={onclear}>Clear</button>
    {#if running}
      <button type="button" class="btn" disabled={cancelling} onclick={oncancel}>Cancel</button>
    {/if}
    <p class="requirements" class:ok={requirement.ready} data-testid="requirements" aria-live="polite">{requirement.message}</p>
    <button type="button" class="btn primary start" disabled={!requirement.ready} title={requirement.message} onclick={onstart}>
      {label}
    </button>
  </div>
</footer>

<style>
  .action-bar {
    position: sticky;
    bottom: 12px;
    z-index: 10;
    display: grid;
    gap: 8px;
    margin-top: 18px;
    padding: 10px 12px 10px 10px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: var(--shadow-md);
  }
  .actions {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .progress-row {
    display: flex;
    gap: 12px;
    align-items: center;
    margin: 0 4px;
  }
  .progress-status {
    margin: 0;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  progress {
    flex: 1;
    height: 8px;
    accent-color: var(--accent);
  }
  .requirements {
    flex: 1;
    margin: 0;
    color: var(--text-muted);
    font-size: 0.93rem;
  }
  .requirements.ok {
    color: var(--ok);
    font-weight: 600;
  }
  .start {
    min-height: 44px;
    padding: 0 22px;
    border-radius: 12px;
  }
  @media (max-width: 560px) {
    .actions {
      flex-wrap: wrap;
    }
    .requirements {
      order: -1;
      flex-basis: 100%;
    }
    .start {
      flex: 1;
    }
  }
</style>
