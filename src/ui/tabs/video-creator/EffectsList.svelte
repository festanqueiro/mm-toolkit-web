<script lang="ts">
  import { pyRound } from "../../../engine/py";
  import type { EffectKey } from "../../../engine/effects/settings";
  import Icon from "../../Icon.svelte";
  import { vc } from "./state.svelte";

  let { disabled = false }: { disabled?: boolean } = $props();

  const LABELS: Record<EffectKey, string> = {
    overlay: "Overlay",
    bass_blur: "Bass-reactive Blur",
    rotate: "Rotate",
    vhs: "VHS",
    glitch: "Glitch",
  };

  const percent = (value: number) => pyRound(value * 100);

  function move(key: EffectKey, to: number) {
    const order = vc.effects.order.filter((k) => k !== key);
    order.splice(Math.max(0, Math.min(order.length, to)), 0, key);
    vc.effects.order = order;
  }

  // Pointer-driven drag (mouse, pen and touch alike): the dragged row follows the pointer
  // across the midpoints of its neighbours.
  let list: HTMLOListElement | undefined = $state();
  let dragging = $state<EffectKey | null>(null);

  function startDrag(event: PointerEvent, key: EffectKey) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragging = key;
  }

  function drag(event: PointerEvent) {
    if (!dragging || !list) return;
    // Target index = how many other rows have their midpoint above the pointer.
    const others = ([...list.children] as HTMLElement[]).filter((row) => row.dataset.key !== dragging);
    const to = others.filter((row) => {
      const box = row.getBoundingClientRect();
      return event.clientY > box.top + box.height / 2;
    }).length;
    if (to !== vc.effects.order.indexOf(dragging)) move(dragging, to);
  }

  function endDrag() {
    dragging = null;
  }

  function keyMove(event: KeyboardEvent, key: EffectKey) {
    const index = vc.effects.order.indexOf(key);
    if (event.key === "ArrowUp" && index > 0) move(key, index - 1);
    else if (event.key === "ArrowDown" && index < vc.effects.order.length - 1) move(key, index + 1);
    else return;
    event.preventDefault();
    // Keep focus on the moved row's handle.
    queueMicrotask(() => list?.querySelector<HTMLElement>(`[data-handle="${key}"]`)?.focus());
  }
</script>

<p class="status hint">Drag rows to change the order effects are applied in.</p>
<ol class="effects" bind:this={list} aria-label="Effect order">
  {#each vc.effects.order as key (key)}
    {@const enabled = vc.effects[key].enabled}
    <li class:dragging={dragging === key} data-key={key}>
      <button
        type="button"
        class="handle"
        title="Drag to reorder"
        aria-label="Reorder {LABELS[key]} (arrow keys)"
        data-handle={key}
        {disabled}
        onpointerdown={(e) => startDrag(e, key)}
        onpointermove={drag}
        onpointerup={endDrag}
        onpointercancel={endDrag}
        onkeydown={(e) => keyMove(e, key)}><Icon name="drag_indicator" size={20} /></button
      >
      <label class="check">
        <input type="checkbox" checked={enabled} {disabled} onchange={(e) => (vc.effects[key].enabled = e.currentTarget.checked)} />
        {LABELS[key]}
      </label>
      <span class="control">
        {#if key === "rotate"}
          <input
            class="input rpm"
            type="number"
            min="0.1"
            max="200"
            step="0.1"
            aria-label="Rotate speed in RPM"
            disabled={disabled || !enabled}
            value={vc.effects.rotate.rpm}
            onchange={(e) => {
              const v = Number(e.currentTarget.value);
              vc.effects.rotate.rpm = Number.isFinite(v) ? Math.min(200, Math.max(0.1, Math.round(v * 10) / 10)) : 33.3;
              e.currentTarget.value = String(vc.effects.rotate.rpm);
            }}
          />
          <span class="unit">RPM</span>
        {:else if key !== "bass_blur"}
          {@const value = key === "overlay" ? vc.effects.overlay.opacity : vc.effects[key].amount}
          <input
            type="range"
            min="0"
            max="100"
            aria-label="{LABELS[key]} {key === 'overlay' ? 'opacity' : 'amount'}"
            disabled={disabled || !enabled}
            value={percent(value)}
            oninput={(e) => {
              const v = Number(e.currentTarget.value) / 100;
              if (key === "overlay") vc.effects.overlay.opacity = v;
              else vc.effects[key].amount = v;
            }}
          />
          <span class="unit pct" aria-hidden="true">{percent(value)}%</span>
        {/if}
      </span>
    </li>
  {/each}
</ol>

<style>
  .hint {
    margin: 0 0 8px;
  }
  .effects {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    transition:
      box-shadow 0.15s,
      border-color 0.15s;
  }
  li.dragging {
    border-color: var(--accent);
    box-shadow: var(--shadow-md);
  }
  .handle {
    width: 28px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    border: 0;
    background: none;
    color: var(--text-muted);
    cursor: grab;
    touch-action: none;
    font-size: 1rem;
  }
  li.dragging .handle {
    cursor: grabbing;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
  }
  .control {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  input[type="range"] {
    width: 120px;
    accent-color: var(--accent);
  }
  .rpm {
    width: 80px;
  }
  .unit {
    color: var(--text-muted);
    font-size: 0.92rem;
  }
  .pct {
    width: 3.2em;
    text-align: right;
  }
</style>
