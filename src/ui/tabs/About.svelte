<script lang="ts">
  import logo from "../../../assets/mm-toolkit-logo-600.png";
  import { detectCapabilities, type Capabilities } from "../../engine/media/capabilities";

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

<h1 class="page-title">About</h1>

<section class="about">
  <img class="logo" src={logo} alt="MM Toolkit logo" width="300" />
  <h2 class="name">MM Toolkit</h2>
  <p>Version {version}</p>
  {#if devBuild}
    <p class="muted">Dev build {devBuild}</p>
  {/if}
  <p class="tagline">Audio &amp; Video tools for all</p>
  <p>
    <a href="https://github.com/festanqueiro/mm-toolkit-web">github.com/festanqueiro/mm-toolkit-web</a>
    · desktop app: <a href="https://github.com/festanqueiro/mm-toolkit">github.com/festanqueiro/mm-toolkit</a>
  </p>
  <p class="muted">Everything is processed on your device. No files are uploaded.</p>
  <p class="muted">
    <a href="https://fonts.google.com/icons">Google Material Icons</a> used under the Apache License 2.0.
  </p>

  <h3>This browser</h3>
  {#await capabilities}
    <p class="muted">Checking capabilities…</p>
  {:then caps}
    <ul class="caps" data-testid="capabilities">
      {#each rows as [label, key, missing] (key)}
        <li>
          <span>{label}</span>
          <span class:ok={caps[key]} class="muted">{caps[key] ? "✓ available" : missing}</span>
        </li>
      {/each}
    </ul>
  {/await}
</section>

<style>
  .page-title {
    margin: 0;
    font-size: 1.6rem;
  }
  .about {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 2px;
  }
  .about p {
    margin: 4px 0;
  }
  .logo {
    max-width: min(300px, 70vw);
    height: auto;
  }
  .name {
    margin: 8px 0 0;
    font-size: 1.8rem;
    font-weight: 600;
  }
  .tagline {
    margin-top: 10px !important;
  }
  .muted {
    color: var(--text-muted);
  }
  .ok {
    color: var(--ok);
  }
  h3 {
    margin: 24px 0 8px;
  }
  .caps {
    list-style: none;
    padding: 0;
    margin: 0;
    width: min(560px, 100%);
    text-align: left;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .caps li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 16px;
    padding: 8px 12px;
  }
  .caps li + li {
    border-top: 1px solid var(--border);
  }
</style>
