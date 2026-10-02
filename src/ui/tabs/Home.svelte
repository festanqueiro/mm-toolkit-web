<script lang="ts">
  import logo from "../../../assets/mm-toolkit-logo-128.png";
  import Icon from "../Icon.svelte";
  import { TOOL_CARDS } from "../tools";
</script>

<section class="hero">
  <img src={logo} alt="" width="64" height="64" />
  <div>
    <h1>Audio &amp; video tools, right in your browser</h1>
    <p>
      Make promo videos, cut clips, convert files and split songs into stems. Everything runs on this device:
      <strong>your files are never uploaded.</strong>
    </p>
  </div>
</section>

<ul class="cards" aria-label="Tools">
  {#each TOOL_CARDS as tool (tool.path)}
    <li>
      <a class="card" href="#/{tool.path}">
        <span class="card-head">
          <span class="tile" aria-hidden="true"><Icon name={tool.icon} size={26} /></span>
          <span class="title">{tool.title}</span>
        </span>
        <span class="summary">{tool.summary}</span>
        <ul class="features">
          {#each tool.features as feature (feature)}
            <li>{feature}</li>
          {/each}
        </ul>
        <span class="open">Open {tool.title} <span aria-hidden="true">→</span></span>
      </a>
    </li>
  {/each}
</ul>

<p class="more">
  <Icon name="lock" size={16} />
  <span>Works offline once loaded. Finished jobs appear in <a href="#/history">History</a>; defaults live in <a href="#/settings">Settings</a>.</span>
</p>

<style>
  .hero {
    display: flex;
    gap: 18px;
    align-items: center;
    margin: 4px 0 28px;
  }
  .hero img {
    flex: none;
    border-radius: 50%;
    box-shadow: var(--shadow-md);
  }
  h1 {
    margin: 0;
    font-size: clamp(1.5rem, 1.1rem + 1.6vw, 2.2rem);
    line-height: 1.15;
    letter-spacing: -0.02em;
  }
  .hero p {
    margin: 8px 0 0;
    max-width: 68ch;
    color: var(--text-muted);
    font-size: 1.02rem;
  }
  .hero strong {
    color: var(--text);
  }
  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 16px;
  }
  @media (min-width: 760px) {
    .cards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .cards > li {
    display: flex;
  }
  .card {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 20px 22px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    color: var(--text);
    text-decoration: none;
    transition:
      border-color 0.15s,
      box-shadow 0.15s,
      transform 0.15s;
  }
  .card:hover {
    border-color: var(--accent);
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
  }
  .card:focus-visible {
    outline: 3px solid var(--focus);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .card {
      transition: none;
    }
    .card:hover {
      transform: none;
    }
  }
  .card-head {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .tile {
    flex: none;
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 14px;
    color: var(--accent);
    background: var(--accent-soft);
  }
  .title {
    font-size: 1.2rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .summary {
    font-weight: 550;
  }
  .features {
    margin: 0;
    padding-left: 1.15em;
    color: var(--text-muted);
    display: grid;
    gap: 3px;
  }
  .open {
    margin-top: auto;
    padding-top: 6px;
    color: var(--accent);
    font-weight: 650;
  }
  .more {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 24px 0 0;
    color: var(--text-muted);
  }
  .more a {
    color: var(--link);
  }
  @media (max-width: 560px) {
    .hero {
      align-items: flex-start;
    }
    .hero img {
      width: 48px;
      height: 48px;
    }
  }
</style>
