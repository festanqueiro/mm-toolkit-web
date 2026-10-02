<script lang="ts">
  /** The job's failure, inline in the rail (replaces the failure dialog). */
  let { title, failure, ondismiss }: { title: string; failure: { message: string; details: string } | null; ondismiss: () => void } = $props();
</script>

{#if failure}
  <div class="rail-error" role="alert" data-testid="job-error">
    <p class="title">{title}</p>
    <p class="message">{failure.message}</p>
    {#if failure.details}
      <details>
        <summary>Details</summary>
        <pre>{failure.details}</pre>
      </details>
    {/if}
    <button type="button" class="btn ghost" onclick={ondismiss}>Dismiss</button>
  </div>
{/if}

<style>
  .rail-error {
    display: grid;
    gap: 6px;
    padding: 12px 14px;
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .title {
    margin: 0;
    font-weight: 700;
    color: var(--warn);
  }
  .message {
    margin: 0;
    overflow-wrap: anywhere;
  }
  pre {
    max-height: 200px;
    overflow: auto;
    font-size: 0.8rem;
    white-space: pre-wrap;
  }
  button {
    justify-self: end;
  }
</style>
