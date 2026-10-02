<script lang="ts">
  import { IMAGE_EXTENSIONS } from "../../../engine/media-kind";
  import { hexColor, parseHexColor } from "../../../engine/video-creator";
  import { pickFiles } from "../../../io/pick";
  import { vc, type LayerKind } from "./state.svelte";

  let { disabled = false }: { disabled?: boolean } = $props();

  const accept = IMAGE_EXTENSIONS.join(",");
  const hex = $derived(hexColor(vc.effects.background.color));

  async function choose(kind: LayerKind) {
    const picked = await pickFiles({ accept });
    if (picked.files[0]) await vc.setLayerImage(kind, picked.files[0].file);
  }
</script>

{#snippet imageRow(kind: LayerKind, id: string)}
  {@const layer = vc.layers[kind]}
  <div class="field">
    <div class="row">
      <input class="input path" readonly aria-labelledby={id} placeholder="Nothing selected" value={layer.file?.name ?? ""} />
      <button type="button" class="btn" {disabled} onclick={() => choose(kind)}>Choose…</button>
      {#if layer.file}
        <button type="button" class="btn" {disabled} onclick={() => vc.setLayerImage(kind, null)}>Clear</button>
      {/if}
    </div>
    {#if layer.error}
      <p class="status warn" data-testid="{kind}-status">{layer.error}</p>
    {:else if layer.image}
      <p class="status ok" data-testid="{kind}-status">✓ {layer.image.width} × {layer.image.height}{layer.image.channels === 4 ? " with transparency" : ""}</p>
    {/if}
  </div>
{/snippet}

<div class="form">
  <h3>Background</h3>
  <label class="label" for="background-fill">Fill</label>
  <div class="field">
    <select
      id="background-fill"
      class="input"
      {disabled}
      value={vc.effects.background.mode}
      onchange={(e) => (vc.effects.background.mode = e.currentTarget.value as "color" | "image")}
    >
      <option value="color">Solid color</option>
      <option value="image">Image</option>
    </select>
  </div>
  {#if vc.effects.background.mode === "color"}
    <label class="label" for="background-color">Color</label>
    <div class="field">
      <label class="swatch" style:background-color={hex}>
        <input
          id="background-color"
          type="color"
          {disabled}
          value={hex}
          oninput={(e) => {
            const rgb = parseHexColor(e.currentTarget.value);
            if (rgb) vc.effects.background.color = rgb;
          }}
        />
        <span class="hex">{hex}</span>
      </label>
    </div>
  {:else}
    <span class="label" id="background-image-label">Image</span>
    {@render imageRow("background", "background-image-label")}
  {/if}

  <h3>Overlay</h3>
  <span class="label" id="overlay-image-label">Image</span>
  {@render imageRow("overlay", "overlay-image-label")}
</div>

<style>
  .form {
    display: grid;
    grid-template-columns: minmax(70px, 110px) 1fr;
    gap: 10px 14px;
    align-items: start;
  }
  h3 {
    grid-column: 1 / -1;
    margin: 4px 0 0;
    font-size: 0.95rem;
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
    min-width: 180px;
  }
  .swatch {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 96px;
    min-height: 36px;
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
  }
  .swatch input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .hex {
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
  }
</style>
