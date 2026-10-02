<script lang="ts">
  /** Requirements, primary button, progress + Cancel, warnings and Clear. */
  let {
    progress,
    running,
    cancelling,
    warnings,
    requirement,
    label,
    progressLabel,
    onstart,
    oncancel,
    onclear,
    onstatus = null,
  }: {
    progress: { percent: number; status: string } | null;
    running: boolean;
    cancelling: boolean;
    warnings: string[];
    requirement: { ready: boolean; message: string };
    label: string;
    progressLabel: string;
    onstart: () => void;
    oncancel: () => void;
    onclear: () => void;
    onstatus?: (() => void) | null;
  } = $props();
</script>

<div class="rail-action">
  <!-- One element across readiness changes: a re-created live region isn't announced. -->
  <p class="requirements" class:ok={requirement.ready} data-testid="requirements" aria-live="polite">{requirement.message}</p>
  <button type="button" class="btn primary start" disabled={!requirement.ready} title={requirement.message} onclick={onstart}>{label}</button>
  {#if progress}
    <div class="progress-row">
      <p class="progress-status" data-testid="progress-status" aria-live="polite">
        {#if onstatus}
          <button type="button" class="link" title="Open in History" onclick={onstatus}>{progress.status}</button>
        {:else}
          {progress.status}
        {/if}
      </p>
      {#if running}
        <progress max="100" value={progress.percent} aria-label={progressLabel}>{progress.percent}%</progress>
      {/if}
    </div>
  {/if}
  {#each warnings as warning (warning)}
    <p class="status warn note">{warning}</p>
  {/each}
  <div class="secondary">
    {#if running}
      <button type="button" class="btn" disabled={cancelling} onclick={oncancel}>Cancel</button>
    {/if}
    <button type="button" class="btn ghost clear" disabled={running} onclick={onclear}>Clear</button>
  </div>
</div>

<style>
  .rail-action {
    display: grid;
    gap: 10px;
  }
  .requirements {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.92rem;
  }
  .requirements.ok {
    color: var(--ok);
    font-weight: 600;
  }
  .start {
    width: 100%;
    min-height: 44px;
    border-radius: 12px;
  }
  .progress-row {
    display: grid;
    gap: 6px;
  }
  .progress-status {
    margin: 0;
    font-weight: 600;
  }
  progress {
    width: 100%;
    height: 8px;
    accent-color: var(--accent);
  }
  .note {
    margin: 0;
    font-size: 0.88rem;
  }
  .secondary {
    display: flex;
    gap: 8px;
    justify-content: space-between;
  }
  .clear {
    margin-left: auto;
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
</style>
