<script lang="ts">
  /** Waveform timeline for sources the native player can't play. Click or drag to seek. */
  let {
    peaks,
    duration,
    position,
    onseek,
  }: { peaks: Float32Array; duration: number; position: number; onseek: (seconds: number) => void } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let width = $state(0);
  let scheme = $state(0);

  // Colours come from theme tokens, so re-read them when the colour scheme flips.
  $effect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const bump = () => scheme++;
    media.addEventListener("change", bump);
    return () => media.removeEventListener("change", bump);
  });

  $effect(() => {
    void scheme;
    if (!canvas || !width) return;
    const height = canvas.clientHeight;
    const ratio = devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(ratio, ratio);
    const style = getComputedStyle(canvas);
    const played = style.getPropertyValue("--accent").trim();
    const rest = style.getPropertyValue("--border-strong").trim();
    const columns = peaks.length / 2;
    const mid = height / 2;
    const head = duration > 0 ? (position / duration) * width : 0;
    for (let x = 0; x < width; x++) {
      const c = Math.min(columns - 1, Math.floor((x / width) * columns));
      const lo = peaks[c * 2]!;
      const hi = peaks[c * 2 + 1]!;
      ctx.fillStyle = x <= head ? played : rest;
      ctx.fillRect(x, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid));
    }
    ctx.fillStyle = style.getPropertyValue("--text").trim();
    ctx.fillRect(Math.min(width - 1, head), 0, 1, height);
  });

  let dragging = false;
  function seekTo(event: PointerEvent) {
    if (!canvas || !duration) return;
    const rect = canvas.getBoundingClientRect();
    onseek(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration);
  }
</script>

<!-- The range input below is the accessible timeline; this is a pointer shortcut. -->
<canvas
  bind:this={canvas}
  bind:clientWidth={width}
  class="waveform"
  data-testid="waveform"
  aria-hidden="true"
  onpointerdown={(e) => {
    dragging = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekTo(e);
  }}
  onpointermove={(e) => dragging && seekTo(e)}
  onpointerup={() => (dragging = false)}
></canvas>

<style>
  .waveform {
    display: block;
    width: 100%;
    height: 120px;
    margin-top: 14px;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    border: 1px solid var(--border);
    cursor: pointer;
    touch-action: none;
  }
</style>
