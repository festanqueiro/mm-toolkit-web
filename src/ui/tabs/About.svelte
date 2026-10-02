<script lang="ts">
  import logo from "../../../assets/mm-toolkit-logo-600.png";
  import { detectCapabilities, type Capabilities } from "../../engine/media/capabilities";
  import { install, pwa } from "../pwa.svelte";

  const version = __APP_VERSION__;
  const devBuild = __DEV_BUILD__;
  const capabilities: Promise<Capabilities> = detectCapabilities();

  const rows: Array<[label: string, key: keyof Capabilities, missing: string]> = [
    ["Hardware video encoding (H.264)", "h264Encode", "unavailable — video export will use a slower fallback"],
    ["AAC audio encoding", "aacEncode", "unavailable — AAC will use a slower fallback"],
    ["GPU effects (WebGL2)", "webgl2", "unavailable"],
    ["Export into a chosen folder", "directoryPicker", "not supported in this browser — files go to Downloads"],
    ["Private storage (OPFS)", "opfs", "unavailable"],
    ["Notifications", "notifications", "unavailable"],
  ];
</script>

<section class="hero">
  <img class="logo" src={logo} alt="MM Toolkit logo" width="180" height="180" />
  <div class="hero-text">
    <h1 class="name">MM Toolkit</h1>
    <p class="tagline">Audio &amp; Video tools for all</p>
    <p class="version">Version {version}</p>
    {#if devBuild}
      <p class="muted">Dev build {devBuild}</p>
    {/if}
    <ul class="chips" aria-label="Tools">
      <li class="chip blue">Video Creator</li>
      <li class="chip pink">Media Cutter</li>
      <li class="chip blue">Media Converter</li>
    </ul>
    <p class="links">
      {#if pwa.canInstall}
        <button type="button" class="btn primary" onclick={install}>Install app</button>
      {/if}
      <a class="btn" href="https://github.com/festanqueiro/mm-toolkit-web">Web app on GitHub</a>
      <a class="btn ghost" href="https://github.com/festanqueiro/mm-toolkit">Desktop app</a>
    </p>
  </div>
</section>

<section class="card">
  <h2>Private by design</h2>
  <p class="muted">
    Everything is processed on your device: decoding, effects and encoding all run in this browser. No files are
    uploaded, and there's no server doing the work.
  </p>
</section>

<section class="card">
  <h2>This browser</h2>
  {#await capabilities}
    <p class="muted">Checking capabilities…</p>
  {:then caps}
    <ul class="caps" data-testid="capabilities">
      {#each rows as [label, key, missing] (key)}
        <li>
          <span>{label}</span>
          <span class="cap" class:ok={caps[key]}>{caps[key] ? "✓ available" : missing}</span>
        </li>
      {/each}
    </ul>
  {/await}
</section>

<p class="credits muted">
  <a href="https://fonts.google.com/icons">Google Material Icons</a> used under the Apache License 2.0.
</p>

<style>
  /* The hero is a fixed dark brand panel (as in the social preview) in both themes. */
  .hero {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 24px 36px;
    padding: 32px;
    margin-bottom: 16px;
    border-radius: 20px;
    color: #eef1f8;
    background:
      radial-gradient(500px 300px at 15% 30%, rgba(120, 90, 190, 0.35), transparent 70%),
      linear-gradient(120deg, #241f33, #0e1018 70%);
    box-shadow: var(--shadow-md);
  }
  .logo {
    width: clamp(110px, 22vw, 180px);
    height: auto;
    filter: drop-shadow(0 10px 30px rgba(124, 197, 255, 0.35));
  }
  .hero-text {
    min-width: 0;
  }
  .name {
    margin: 0;
    font-size: clamp(2rem, 1.4rem + 2.4vw, 3rem);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.05;
  }
  .tagline {
    margin: 6px 0 0;
    font-size: 1.15rem;
    color: #a9b0c4;
  }
  .version {
    margin: 10px 0 0;
    font-variant-numeric: tabular-nums;
    color: #a9b0c4;
  }
  .hero .muted {
    color: #8b93a8;
    margin: 2px 0 0;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 16px 0 0;
    padding: 0;
    list-style: none;
  }
  .chip {
    padding: 4px 12px;
    border: 1.5px solid currentColor;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 650;
  }
  .chip.blue {
    color: #7cc5ff;
  }
  .chip.pink {
    color: #ff5ad9;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 18px 0 0;
  }
  .links .btn {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
  }
  .hero .btn.ghost {
    color: #eef1f8;
    border-color: rgba(255, 255, 255, 0.25);
  }
  .hero .btn.ghost:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .card {
    margin-bottom: 16px;
    padding: 18px 20px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .card h2 {
    margin: 0 0 10px;
    font-size: 1.02rem;
  }
  .card p {
    margin: 0;
  }
  .muted {
    color: var(--text-muted);
  }
  .caps {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .caps li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 16px;
    padding: 9px 0;
  }
  .caps li + li {
    border-top: 1px solid var(--border);
  }
  .cap {
    color: var(--text-muted);
  }
  .cap.ok {
    color: var(--ok);
    font-weight: 600;
  }
  .credits {
    font-size: 0.85rem;
  }
  .credits a {
    color: inherit;
  }
</style>
