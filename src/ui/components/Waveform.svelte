<script lang="ts">
  /**
   * Audio waveform with regions (specs 04, 05). Each clip is a region; the current one's edges
   * are handles that can be dragged, or moved with the arrow keys, and with `onmove` the region
   * itself can be dragged along. With `onseek` it is also a timeline: click or drag to seek, and
   * the played part is tinted up to the playhead.
   */
  import { handleZones, regionAt, type ClipRegion } from "../../engine/clip-regions";
  import { formatTimestamp } from "../../engine/time";

  type Edge = "start" | "end";
  const EDGES = ["start", "end"] as const;

  let {
    peaks,
    duration,
    position = 0,
    onseek,
    regions = [],
    currentKey = null,
    currentLabel = "",
    disabled = false,
    onselect,
    onedge,
    onmove,
    edgeText = (_edge, seconds) => formatTimestamp(seconds),
  }: {
    peaks: Float32Array;
    duration: number;
    position?: number;
    /** Makes the waveform a seekable timeline with a playhead. */
    onseek?: (seconds: number) => void;
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
    /** Makes the current region draggable as a whole: it was moved so that it starts at `seconds`. */
    onmove?: (seconds: number) => void;
    /** What a handle's position reads as, on its bubble and to assistive technology. */
    edgeText?: (edge: Edge, seconds: number) => string;
  } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let width = $state(0);
  let scheme = $state(0);

  const current = $derived(regions.find((region) => region.key === currentKey) ?? null);
  const percent = (seconds: number) => (duration > 0 ? (seconds / duration) * 100 : 0);
  const pixels = (seconds: number) => (percent(seconds) / 100) * width;
  const zones = $derived(current ? handleZones(pixels(current.start), pixels(current.end), width) : null);

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
    const head = onseek && duration > 0 ? (position / duration) * width : -1;
    for (let x = 0; x < width; x++) {
      const c = Math.min(columns - 1, Math.floor((x / width) * columns));
      const lo = peaks[c * 2]!;
      const hi = peaks[c * 2 + 1]!;
      ctx.fillStyle = x <= head ? played : rest;
      ctx.fillRect(x, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid));
    }
    if (head < 0) return;
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
    onseek?.(Math.max(0, Math.min(duration, secondsAt(event))));
  }

  /** What is being dragged (an edge, or the whole region), and how far from it the pointer grabbed. */
  let drag = $state<{ part: Edge | "region"; offset: number } | null>(null);
  function grab(event: PointerEvent, part: Edge | "region") {
    if (disabled || !current || !canvas) return;
    drag = { part, offset: secondsAt(event) - current[part === "end" ? "end" : "start"] };
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
    class:seekable={!!onseek}
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
    {@const movable = !!onmove && region.key === currentKey && !disabled}
    <!-- svelte-ignore a11y_no_static_element_interactions (a pointer shortcut: the start handle moves it from the keyboard) -->
    <div
      class="region"
      class:current={region.key === currentKey}
      class:movable
      class:dragging={movable && drag?.part === "region"}
      data-testid="clip-region"
      style:left="{percent(region.start)}%"
      style:width="{percent(region.end - region.start)}%"
      onpointerdown={(e) => movable && grab(e, "region")}
      onpointermove={(e) => movable && drag?.part === "region" && onmove?.(secondsAt(e) - drag.offset)}
      onpointerup={() => (drag = null)}
      onpointercancel={() => (drag = null)}
    ></div>
  {/each}
  {#if current && zones}
    {#each EDGES as edge (edge)}
      {@const zone = zones[edge]}
      {@const at = pixels(current[edge])}
      <div
        class="handle"
        class:dragging={drag?.part === edge}
        role="slider"
        tabindex={disabled ? -1 : 0}
        aria-label="{edge === 'start' ? 'Start' : 'End'} of {currentLabel}"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.ceil(duration)}
        aria-valuenow={current[edge]}
        aria-valuetext={edgeText(edge, current[edge])}
        aria-disabled={disabled}
        style:left="{zone.left}px"
        style:width="{zone.width}px"
        style:--line="{at - zone.left}px"
        onpointerdown={(e) => grab(e, edge)}
        onpointermove={(e) => drag?.part === edge && onedge?.(edge, secondsAt(e) - drag.offset)}
        onpointerup={() => (drag = null)}
        onpointercancel={() => (drag = null)}
        onkeydown={(e) => nudge(e, edge)}
      >
        <span class="line"></span>
        <span class="grip"></span>
      </div>
      {#if drag && (drag.part === edge || (drag.part === "region" && edge === "start"))}
        <!-- Kept inside the waveform at its ends. -->
        <span class="time {edge}" data-testid="handle-time" aria-hidden="true" style:left="{Math.max(36, Math.min(width - 36, at))}px">
          {edgeText(edge, current[edge])}
        </span>
      {/if}
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
  }
  canvas.seekable {
    cursor: pointer;
    touch-action: none;
  }
  .region {
    position: absolute;
    top: 0;
    bottom: 0;
    pointer-events: none;
    background: color-mix(in srgb, var(--text-muted) 16%, transparent);
    box-shadow: inset 1px 0 0 var(--border-strong), inset -1px 0 0 var(--border-strong);
  }
  .region.current {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    box-shadow: none;
  }
  /* The whole clip can be dragged along. */
  .region.movable {
    pointer-events: auto;
    cursor: grab;
    touch-action: none;
  }
  .region.movable:hover,
  .region.dragging {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .region.dragging {
    cursor: grabbing;
  }
  /* A handle's grab zone straddles its edge (`handleZones`); `--line` is where the edge is within it. */
  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: var(--radius-sm);
    cursor: ew-resize;
    touch-action: none;
  }
  .line,
  .grip {
    position: absolute;
    left: var(--line);
    background: var(--accent);
    pointer-events: none;
  }
  .line {
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
  }
  .grip {
    top: 50%;
    width: 14px;
    height: 56px;
    border-radius: 7px;
    border: 2px solid var(--surface);
    box-shadow: var(--shadow-sm);
    transform: translate(-50%, -50%);
    transition:
      transform 0.12s,
      background-color 0.12s;
  }
  .handle:hover .grip,
  .handle.dragging .grip,
  .handle:focus-visible .grip {
    background: var(--accent-hover);
    transform: translate(-50%, -50%) scale(1.15);
  }
  .handle:hover .line,
  .handle.dragging .line {
    width: 4px;
    margin-left: -2px;
  }
  .handle[aria-disabled="true"] {
    cursor: default;
  }
  .handle[aria-disabled="true"] .grip {
    background: var(--accent);
    transform: translate(-50%, -50%);
  }
  .handle[aria-disabled="true"] .line {
    width: 2px;
    margin-left: -1px;
  }
  .handle:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
  /* The dragged handle's time: Start's at the top, End's at the bottom, so they never collide. */
  .time {
    position: absolute;
    top: 4px;
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-sm);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    transform: translateX(-50%);
    pointer-events: none;
  }
  .time.end {
    top: auto;
    bottom: 4px;
  }
  @media (prefers-reduced-motion: reduce) {
    .grip {
      transition: none;
    }
  }
</style>
