<script lang="ts">
  /**
   * Waveform timeline for audio sources (spec 05). Click or drag to seek. Each clip is a region;
   * the current clip's edges are handles that can be dragged, or moved with the arrow keys.
   */
  import { regionAt, type ClipRegion } from "../../../engine/clip-regions";
  import { formatTimestamp } from "../../../engine/time";

  type Edge = "start" | "end";
  const EDGES = ["start", "end"] as const;

  let {
    peaks,
    duration,
    position,
    onseek,
    regions = [],
    currentKey = null,
    currentLabel = "",
    disabled = false,
    onselect,
    onedge,
  }: {
    peaks: Float32Array;
    duration: number;
    position: number;
    onseek: (seconds: number) => void;
    regions?: ClipRegion[];
    /** The region that gets the handles. */
    currentKey?: string | null;
    /** Its clip's title, for the handles' names. */
    currentLabel?: string;
    /** Handles are shown but can't be moved (a job is running). */
    disabled?: boolean;
    onselect?: (key: string) => void;
    /** An edge of the current region was moved to `seconds` (unsnapped, unclamped). */
    onedge?: (edge: Edge, seconds: number) => void;
  } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let width = $state(0);
  let scheme = $state(0);

  const current = $derived(regions.find((region) => region.key === currentKey) ?? null);
  const percent = (seconds: number) => (duration > 0 ? (seconds / duration) * 100 : 0);

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

  function secondsAt(event: PointerEvent): number {
    const rect = canvas!.getBoundingClientRect();
    return ((event.clientX - rect.left) / rect.width) * duration;
  }

  let seeking = false;
  function seekTo(event: PointerEvent) {
    if (!canvas || !duration) return;
    onseek(Math.max(0, Math.min(duration, secondsAt(event))));
  }

  /** The edge being dragged, and how far from it the pointer grabbed the handle. */
  let drag: { edge: Edge; offset: number } | null = null;
  function grab(event: PointerEvent, edge: Edge) {
    if (disabled || !current || !canvas) return;
    drag = { edge, offset: secondsAt(event) - current[edge] };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  function nudge(event: KeyboardEvent, edge: Edge) {
    const direction = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
    if (!direction || disabled || !current) return;
    event.preventDefault();
    onedge?.(edge, current[edge] + direction * (event.shiftKey ? 10 : 1));
  }
</script>

<div class="waveform">
  <!-- The range input below is the accessible timeline; this is a pointer shortcut. -->
  <canvas
    bind:this={canvas}
    bind:clientWidth={width}
    data-testid="waveform"
    aria-hidden="true"
    onpointerdown={(e) => {
      seeking = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      seekTo(e);
      const key = duration ? regionAt(regions, secondsAt(e), currentKey) : null;
      if (key && key !== currentKey) onselect?.(key);
    }}
    onpointermove={(e) => seeking && seekTo(e)}
    onpointerup={() => (seeking = false)}
    onpointercancel={() => (seeking = false)}
  ></canvas>
  {#each regions as region (region.key)}
    <div
      class="region"
      class:current={region.key === currentKey}
      data-testid="clip-region"
      style:left="{percent(region.start)}%"
      style:width="{percent(region.end - region.start)}%"
    ></div>
  {/each}
  {#if current}
    {#each EDGES as edge (edge)}
      <div class="edge" style:left="{percent(current[edge])}%"></div>
      <div
        class="handle {edge}"
        role="slider"
        tabindex={disabled ? -1 : 0}
        aria-label="{edge === 'start' ? 'Start' : 'End'} of {currentLabel}"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.ceil(duration)}
        aria-valuenow={current[edge]}
        aria-valuetext={formatTimestamp(current[edge])}
        aria-disabled={disabled}
        style:--at="{percent(current[edge])}%"
        onpointerdown={(e) => grab(e, edge)}
        onpointermove={(e) => drag?.edge === edge && onedge?.(edge, secondsAt(e) - drag.offset)}
        onpointerup={() => (drag = null)}
        onpointercancel={() => (drag = null)}
        onkeydown={(e) => nudge(e, edge)}
      ></div>
    {/each}
  {/if}
</div>

<style>
  .waveform {
    position: relative;
    height: 120px;
    margin-top: 14px;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    border: 1px solid var(--border);
    /* A drag here moves a handle or the playhead; it must never select (WebKit then drags the selection instead). */
    -webkit-user-select: none;
    user-select: none;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: inherit;
    cursor: pointer;
    touch-action: none;
  }
  .region,
  .edge {
    position: absolute;
    top: 0;
    bottom: 0;
    pointer-events: none;
  }
  .region {
    background: color-mix(in srgb, var(--text-muted) 16%, transparent);
    box-shadow: inset 1px 0 0 var(--border-strong), inset -1px 0 0 var(--border-strong);
  }
  .region.current {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    box-shadow: none;
  }
  .edge {
    width: 2px;
    margin-left: -1px;
    background: var(--accent);
  }
  /* The grip. */
  .edge::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 8px;
    height: 32px;
    border-radius: 4px;
    background: var(--accent);
    transform: translate(-50%, -50%);
  }
  /* Hit areas sit outside the clip so the two never overlap, and fold inward at the track's ends. */
  .handle {
    --hit: 28px;
    position: absolute;
    top: 0;
    bottom: 0;
    width: var(--hit);
    border-radius: var(--radius-sm);
    cursor: ew-resize;
    touch-action: none;
  }
  .handle.start {
    left: max(0px, calc(var(--at) - var(--hit)));
  }
  .handle.end {
    left: min(calc(100% - var(--hit)), var(--at));
  }
  .handle[aria-disabled="true"] {
    cursor: default;
  }
  .handle:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
</style>
