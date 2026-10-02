# Tool Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace each tool's two equal columns + sticky footer with a 75 % scrollable setup column and a 25 % sticky output rail (Preview → Export → Action → Error → Results), shared by all four tools.

**Architecture:** New presentation-only Svelte components (`ToolLayout`, `SetupSection`, `RailBlock`, `RailAction`, `RailError`, `RailResults`) plus one helper (`ui/job-results.ts`) that turns a finished job's outputs into playable/downloadable results. Each tool page is re-composed from these; tool state classes gain `results`/`savedTo`. Engines, workers and jobs are untouched.

**Tech Stack:** Svelte 5 (runes), TypeScript 6, Vite 8, Vitest (unit), Playwright (e2e: chromium, webkit, firefox), axe-core.

**Spec:** `docs/superpowers/specs/2026-10-02-tool-layout-redesign-design.md`

## Global Constraints

- Tool pages max width **1440 px**; other pages keep **1240 px**.
- Rail width `clamp(300px, 25%, 380px)`; grid gap **20 px**; rail `position: sticky`, scrolls internally when taller than the viewport.
- Breakpoint for the stacked layout + bottom bar: **< 1000 px** (`(min-width: 1000px)` is "wide").
- Setup sections are **always open**: no accordions, no auto-scroll.
- Rail block order: **Preview** (Video Creator only) → **Export** → **Action** → **Error** → **Results**.
- Keep existing user-facing strings, `data-testid`s, labels and button names unless this plan says otherwise.
- Colours only from theme tokens (CLAUDE.md); no hardcoded colours in components.
- Every PR to `main` bumps the **patch** version in `package.json` and adds a `CHANGELOG.md` section (the Release workflow rejects un-bumped merges).
- Conventional Commits; commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The axe audit `e2e/a11y.spec.ts` must stay at **0 violations**.

## Review Focus

1. **Duplicate interactive elements on narrow screens**: the action must render **once** (rail when wide, bottom bar when narrow), otherwise `getByTestId("progress-status")` and screen readers see two. Pinned by the narrow-screen e2e in Task 3.
2. **Results after a Tier-1 (folder) job**: results must open files from the chosen folder (via `resolveOutputs`), not only in-memory/staged copies. Pinned by the Converter e2e on Chromium in Task 3.
3. **Results reset**: starting a new job or pressing Clear must empty the previous results list (stale players for files that no longer match the form). Pinned in Task 3's e2e.
4. **Object URL leaks**: `RailResults` must revoke URLs when results change or the page unmounts. Pinned by a unit-free review + the e2e that runs two jobs in a row (Task 3).
5. **Video Creator controls before audio + visual are valid**: the always-open Effects/Layers/Post-effects sections must keep their controls **disabled** until ready (today the accordions were disabled). Pinned in Task 7's e2e.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/ui/job-results.ts` (new) | `jobResults(outputs, record, root?)` + `savedToLabel(directory, folderName)` |
| `src/ui/components/ToolLayout.svelte` (new) | Page header + responsive setup/rail grid, wide/narrow switch, bottom bar |
| `src/ui/components/SetupSection.svelte` (new) | Always-open section card with optional status |
| `src/ui/components/RailBlock.svelte` (new) | Titled block in the rail; container for narrow form layout |
| `src/ui/components/RailAction.svelte` (new) | Requirements, primary button, progress, Cancel, warnings, Clear |
| `src/ui/components/RailError.svelte` (new) | Inline failure card |
| `src/ui/components/RailResults.svelte` (new) | Results list with players + Download + Open in History |
| `src/ui/tabs/converter/*`, `cutter/*`, `stems/*`, `video-creator/*` (modify) | Re-compose pages; state gains `results`, `savedTo` |
| `src/ui/components/JobFooter.svelte`, `Accordion.svelte` (delete, Task 8) | Replaced |
| `tests/job-results.test.ts` (new) | Unit tests for the helper |
| `e2e/layout.spec.ts` (new) | Rail/results/narrow-screen behaviour |
| `e2e/*.spec.ts` (modify) | Selector updates listed per task |
| `docs/specs/09-app-shell-and-about.md` (modify, Task 8) | Layout section |

---

### Task 1: `jobResults` helper

**Files:**
- Create: `src/ui/job-results.ts`
- Test: `tests/job-results.test.ts`

**Interfaces:**
- Consumes: `resolveOutputs(record, root?)` and `AvailableOutput` from `src/io/history-outputs.ts`; `OutputRef` from `src/io/sink.ts`.
- Produces: `jobResults(outputs: OutputRef[], record: Record<string, unknown>, root?: FileSystemDirectoryHandle): Promise<AvailableOutput[]>` and `savedToLabel(directory: boolean, folderName: string | undefined): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/job-results.test.ts
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createStagingSink } from "../src/io/sink";
import { jobResults, savedToLabel } from "../src/ui/job-results";
import { asDir, FakeDirectoryHandle } from "./fake-fs";

describe("jobResults", () => {
  it("in-memory outputs are returned directly, in order", async () => {
    const a = new File(["a"], "a.wav");
    const b = new File(["bb"], "b.wav");
    const results = await jobResults(
      [
        { name: "a.wav", sink: "memory", file: a },
        { name: "b.wav", sink: "memory", file: b },
      ],
      { outputs: [] },
    );
    expect(results.map((r) => r.name)).toEqual(["a.wav", "b.wav"]);
    expect(await results[1]!.open()).toBe(b);
  });

  it("staged outputs resolve through OPFS", async () => {
    const root = new FakeDirectoryHandle();
    const sink = await createStagingSink("job-1", asDir(root));
    const writer = (await sink.create("x.mp3")).getWriter();
    await writer.write(new Uint8Array(3));
    await writer.close();
    const ref = await sink.complete("x.mp3");
    const results = await jobResults([ref], { output: { name: "Downloads" }, outputs: [ref] }, asDir(root));
    expect(results.map((r) => r.name)).toEqual(["x.mp3"]);
    expect((await results[0]!.open()).size).toBe(3);
  });

  it("no outputs → no results", async () => {
    expect(await jobResults([], { outputs: [] })).toEqual([]);
  });
});

describe("savedToLabel", () => {
  it("folder or Downloads", () => {
    expect(savedToLabel(true, "Exports")).toBe("Saved to Exports");
    expect(savedToLabel(true, undefined)).toBe("Saved to your export folder");
    expect(savedToLabel(false, "Exports")).toBe("Downloaded");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/job-results.test.ts`
Expected: FAIL, `Cannot find module '../src/ui/job-results'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/ui/job-results.ts
/**
 * A finished job's outputs as results the rail can play and download (spec: tool layout
 * redesign, "Results data flow"). In-memory outputs (no OPFS) carry their File; everything
 * else resolves like History does: the export folder's handle, or the kept OPFS copy.
 */
import { resolveOutputs, type AvailableOutput } from "../io/history-outputs";
import type { OutputRef } from "../io/sink";

export async function jobResults(outputs: OutputRef[], record: Record<string, unknown>, root?: FileSystemDirectoryHandle): Promise<AvailableOutput[]> {
  if (!outputs.length) return [];
  if (outputs.every((o) => o.file)) return outputs.map((o) => ({ name: o.name, open: async () => o.file!, staged: false }));
  return (await resolveOutputs(record, root)).files;
}

export const savedToLabel = (directory: boolean, folderName: string | undefined) =>
  directory ? `Saved to ${folderName || "your export folder"}` : "Downloaded";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/job-results.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/job-results.ts tests/job-results.test.ts
git commit -m "feat: add a shared helper for a job's playable results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Layout and rail components

**Files:**
- Create: `src/ui/components/ToolLayout.svelte`, `SetupSection.svelte`, `RailBlock.svelte`, `RailAction.svelte`, `RailError.svelte`, `RailResults.svelte`

**Interfaces:**
- Consumes: `PageHeader.svelte` (`title`, `subtitle`, `icon`), `IconName` from `src/ui/icons.ts`, `AvailableOutput` (Task 1's re-export source `src/io/history-outputs.ts`), `openHistory(id)` from `src/ui/history.svelte.ts`, `mediaKind(name)` from `src/engine/media-kind.ts`, `formatBytes(n)` from `src/engine/history.ts`.
- Produces (used by Tasks 3, 5, 6, 7):
  - `ToolLayout` props: `title: string`, `subtitle: string`, `icon: IconName`; snippets `setup`, `rail`, `action`, `after` (error + results).
  - `SetupSection` props: `title: string`, `status?: string`, `tone?: "ok" | "warn" | "muted"`; snippet `children`.
  - `RailBlock` props: `title: string`; snippet `children`.
  - `RailAction` props: `progress: {percent:number;status:string}|null`, `running: boolean`, `cancelling: boolean`, `warnings: string[]`, `requirement: {ready:boolean;message:string}`, `label: string`, `progressLabel: string`, `onstart`, `oncancel`, `onclear: () => void`, `onstatus?: (() => void) | null`.
  - `RailError` props: `title: string`, `failure: {message:string;details:string}|null`, `ondismiss: () => void`.
  - `RailResults` props: `results: AvailableOutput[]`, `savedTo: string`, `historyId: string | null`.

These components have no behaviour of their own worth unit-testing outside a page; Task 3's e2e exercises all of them through the Media Converter.

- [ ] **Step 1: Create `SetupSection.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  /** An always-open setup section (spec: tool layout redesign). `status` is information only. */
  let { title, status = "", tone = "muted", children }: { title: string; status?: string; tone?: "ok" | "warn" | "muted"; children: Snippet } = $props();
  const id = `setup-${Math.random().toString(36).slice(2, 9)}`;
</script>

<section class="setup-section" aria-labelledby={id}>
  <header>
    <h2 {id}>{title}</h2>
    {#if status}<span class="section-status {tone}">{status}</span>{/if}
  </header>
  {@render children()}
</section>

<style>
  .setup-section {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    padding: 18px 20px 20px;
  }
  header {
    display: flex;
    gap: 12px;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  h2 {
    margin: 0;
    font-size: 1.02rem;
    font-weight: 700;
  }
  .section-status {
    font-size: 0.88rem;
    color: var(--text-muted);
    text-align: right;
  }
  .section-status.ok {
    color: var(--ok);
  }
  .section-status.warn {
    color: var(--warn);
  }
</style>
```

- [ ] **Step 2: Create `RailBlock.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  /** A titled block in the output rail; a size container so forms inside can stack. */
  let { title, children }: { title: string; children: Snippet } = $props();
  const id = `rail-${Math.random().toString(36).slice(2, 9)}`;
</script>

<section class="rail-block" aria-labelledby={id}>
  <h2 {id}>{title}</h2>
  {@render children()}
</section>

<style>
  .rail-block {
    container: rail / inline-size;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    padding: 14px 16px 16px;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 0.95rem;
    font-weight: 700;
  }
</style>
```

- [ ] **Step 3: Create `RailAction.svelte`**

```svelte
<script lang="ts">
  /** Requirements, primary button, progress + Cancel, warnings and Clear (replaces JobFooter). */
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
  {#if !requirement.ready}
    <p class="requirements" data-testid="requirements" aria-live="polite">{requirement.message}</p>
  {:else}
    <p class="requirements ok" data-testid="requirements" aria-live="polite">{requirement.message}</p>
  {/if}
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
```

- [ ] **Step 4: Create `RailError.svelte`**

```svelte
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
```

- [ ] **Step 5: Create `RailResults.svelte`**

```svelte
<script lang="ts">
  import { formatBytes } from "../../engine/history";
  import { mediaKind } from "../../engine/media-kind";
  import type { AvailableOutput } from "../../io/history-outputs";
  import { openHistory } from "../history.svelte";
  import RailBlock from "./RailBlock.svelte";

  /** The last job's files: player + Download each (spec: tool layout redesign, "Results"). */
  let { results, savedTo, historyId }: { results: AvailableOutput[]; savedTo: string; historyId: string | null } = $props();

  let files = $state<{ name: string; url: string; size: number; video: boolean }[]>([]);

  // Object URLs for the current results; revoked when results change or the page unmounts.
  $effect(() => {
    const list = results;
    let live = true;
    const made: { name: string; url: string; size: number; video: boolean }[] = [];
    void (async () => {
      for (const result of list) {
        const file = await result.open().catch(() => null);
        if (!file) continue;
        made.push({ name: result.name, url: URL.createObjectURL(file), size: file.size, video: mediaKind(result.name) === "video" });
      }
      if (live) files = [...made];
    })();
    return () => {
      live = false;
      for (const f of made) URL.revokeObjectURL(f.url);
      files = [];
    };
  });

  function download(name: string, url: string) {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
  }
</script>

{#if results.length}
  <RailBlock title="Results">
    <p class="saved" data-testid="results-saved">
      {savedTo}{#if historyId} · <button type="button" class="link" onclick={() => openHistory(historyId)}>Open in History</button>{/if}
    </p>
    <ul class="results" aria-label="Results">
      {#each files as file (file.name)}
        <li>
          <div class="row">
            <span class="name" title={file.name}>{file.name}</span>
            <span class="size">{formatBytes(file.size)}</span>
          </div>
          {#if file.video}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video src={file.url} controls playsinline preload="metadata" aria-label="Play {file.name}"></video>
          {:else}
            <audio src={file.url} controls preload="metadata" aria-label="Play {file.name}"></audio>
          {/if}
          <button type="button" class="btn" onclick={() => download(file.name, file.url)}>Download</button>
        </li>
      {/each}
    </ul>
  </RailBlock>
{/if}

<style>
  .saved {
    margin: 0 0 10px;
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 12px;
  }
  .results li {
    display: grid;
    gap: 6px;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: baseline;
    min-width: 0;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .size {
    flex: none;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  audio,
  video {
    width: 100%;
  }
  video {
    max-height: 200px;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
  }
  li > .btn {
    justify-self: start;
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
```

- [ ] **Step 6: Create `ToolLayout.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { IconName } from "../icons";
  import PageHeader from "./PageHeader.svelte";

  /**
   * Tool page: setup (75 %, scrollable, always-open sections) | sticky output rail (25 %).
   * Under 1000 px everything stacks and the action moves to a sticky bottom bar. The action
   * renders exactly once (rail when wide, bar when narrow) so it never exists twice.
   */
  let {
    title,
    subtitle,
    icon,
    setup,
    rail,
    action,
    after,
  }: { title: string; subtitle: string; icon: IconName; setup: Snippet; rail: Snippet; action: Snippet; after: Snippet } = $props();

  let wide = $state(matchMedia("(min-width: 1000px)").matches);
  $effect(() => {
    const query = matchMedia("(min-width: 1000px)");
    const update = () => (wide = query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  });
</script>

<div class="tool-page">
  <PageHeader {title} {subtitle} {icon} />
  <div class="tool" class:wide>
    <div class="setup">{@render setup()}</div>
    <aside class="rail" aria-label="Output" data-testid="rail">
      {@render rail()}
      {#if wide}
        <div class="rail-action-block">{@render action()}</div>
      {/if}
      {@render after()}
    </aside>
  </div>
  {#if !wide}
    <div class="bar" data-testid="action-bar">{@render action()}</div>
  {/if}
</div>

<style>
  .tool-page {
    /* Tool pages get more room than text pages (1240 px). */
    width: min(1440px, 100%);
    margin-inline: auto;
  }
  .tool {
    display: grid;
    gap: 20px;
    align-items: start;
  }
  .setup,
  .rail {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }
  .tool.wide {
    grid-template-columns: minmax(0, 1fr) clamp(300px, 25%, 380px);
  }
  .tool.wide .rail {
    position: sticky;
    top: 76px;
    max-height: calc(100vh - 96px);
    overflow: auto;
    padding-bottom: 4px;
  }
  .rail-action-block {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    padding: 14px 16px;
  }
  .bar {
    position: sticky;
    bottom: 12px;
    z-index: 10;
    margin-top: 16px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: var(--shadow-md);
  }
</style>
```

Note: `App.svelte`'s `.page` caps content at 1240 px. Task 3 Step 6 widens `.page` for tool routes.

- [ ] **Step 7: Type-check**

Run: `npm run check`
Expected: `0 ERRORS 0 WARNINGS` (components aren't used yet; svelte-check still type-checks them).

- [ ] **Step 8: Commit**

```bash
git add src/ui/components/ToolLayout.svelte src/ui/components/SetupSection.svelte src/ui/components/RailBlock.svelte src/ui/components/RailAction.svelte src/ui/components/RailError.svelte src/ui/components/RailResults.svelte
git commit -m "feat: add the tool layout and output rail components

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Migrate the Media Converter (proves the pattern)

**Files:**
- Modify: `src/ui/tabs/converter/state.svelte.ts` (results, savedTo, record returns the record)
- Modify: `src/ui/tabs/converter/MediaConverter.svelte` (markup → ToolLayout)
- Modify: `src/ui/App.svelte` (wider `.page` for tool routes)
- Modify: `e2e/converter.spec.ts`, `e2e/history.spec.ts`, `e2e/a11y.spec.ts` (selectors)
- Create: `e2e/layout.spec.ts`

**Interfaces:**
- Consumes: Task 1 `jobResults`, `savedToLabel`; Task 2 components (props as listed in Task 2).
- Produces: `converter.results: AvailableOutput[]`, `converter.savedTo: string`, the same fields Tasks 5–7 add to their tools.

- [ ] **Step 1: Write the failing e2e (`e2e/layout.spec.ts`)**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { mockFolderPicker } from "./helpers";

const golden = (name: string) => fileURLToPath(new URL(`../fixtures/golden/${name}`, import.meta.url));

async function convertOne(page: Page, browserName: string, format = "wav") {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose Audio or Video Files…" }).click();
  await (await chooser).setFiles(golden("audio/short-10s-mono.wav"));
  await page.getByLabel("Convert to").selectOption(format);
  if (browserName === "chromium") await page.getByRole("region", { name: "Export" }).getByRole("button", { name: "Choose…" }).click();
  const download = browserName === "chromium" ? null : page.waitForEvent("download");
  await page.getByRole("button", { name: "Convert Files" }).click();
  await download;
  await expect(page.getByTestId("progress-status")).toHaveText("Finished 1 conversion", { timeout: 60_000 });
}

test("the rail holds export, action and results; results play and download", async ({ page, browserName }) => {
  if (browserName === "chromium") await mockFolderPicker(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/converter");
  const rail = page.getByRole("complementary", { name: "Output" });
  await expect(rail.getByRole("region", { name: "Export" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Convert Files" })).toBeVisible();
  await convertOne(page, browserName);
  const results = rail.getByRole("list", { name: "Results" });
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await expect(results.locator("audio")).toHaveCount(1);
  await expect(page.getByTestId("results-saved")).toContainText(browserName === "chromium" ? "Saved to exports-test" : "Downloaded");
  const download = page.waitForEvent("download");
  await results.getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("short-10s-mono.wav");

  // A new job replaces the results; Clear empties them.
  await convertOne(page, browserName, "flac");
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await expect(results).toContainText("short-10s-mono.flac");
  await rail.getByRole("button", { name: "Clear" }).click();
  await expect(rail.getByRole("list", { name: "Results" })).toHaveCount(0);
});

test("the rail stays in view while the setup scrolls (wide screens)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto("/#/converter");
  const button = page.getByRole("button", { name: "Convert Files" });
  const before = await button.boundingBox();
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(200);
  const after = await button.boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(80);
});

test("narrow screens: one column, the action in a bottom bar, no overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/#/converter");
  await expect(page.getByTestId("action-bar").getByRole("button", { name: "Convert Files" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Convert Files" })).toHaveCount(1);
  await expect(page.getByTestId("requirements")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
```

Note: the e2e folder mock names the folder `exports-test` (see `e2e/helpers.ts` `mockFolderPicker`).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test e2e/layout.spec.ts --project=chromium`
Expected: FAIL (no `complementary "Output"`, no `region "Export"`, no `action-bar`).

- [ ] **Step 3: Add results to the Converter state**

In `src/ui/tabs/converter/state.svelte.ts`:

1. Add imports:

```ts
import type { AvailableOutput } from "../../../io/history-outputs";
import { jobResults, savedToLabel } from "../../job-results";
```

2. Add fields next to `lastJobId`:

```ts
  /** The last job's files, playable in the rail (cleared by Clear and when a job starts). */
  results = $state.raw<AvailableOutput[]>([]);
  savedTo = $state("");
```

3. In `convert()`, right after `this.warnings = [];` add:

```ts
    this.results = [];
```

4. Replace the call `await this.record(jobId, sources, format, bitrate, outputs, !!handle);` with:

```ts
      const record = await this.record(jobId, sources, format, bitrate, outputs, !!handle);
      this.results = await jobResults(outputs, record).catch(() => []);
      this.savedTo = savedToLabel(!!handle, this.folder.ref?.name);
```

5. Change `record()` to build the object, add it to History best-effort, and **return** it. Replace the whole method with:

```ts
  private async record(id: string, sources: File[], format: string, bitrate: string, outputs: OutputRef[], directory: boolean): Promise<Record<string, unknown>> {
    const ref = (f: File) => ({ name: f.name, size: f.size, lastModified: f.lastModified });
    const record = {
      id,
      tool: "converter" as const,
      created: localTimestamp(),
      source: ref(sources[0]!),
      sources: sources.map(ref),
      output: directory ? ($state.snapshot(this.folder.ref) as FileRef | null) : { name: "Downloads" },
      format,
      bitrate,
      outputs: historyOutputs(outputs),
    };
    try {
      await addHistory(record);
      this.lastJobId = id;
      jobRecorded(id);
    } catch {
      // History is best effort (storage may be unavailable).
    }
    return record;
  }
```

6. In `clear()`, after `this.warnings = [];` add:

```ts
    this.results = [];
```

- [ ] **Step 4: Re-compose `MediaConverter.svelte`**

Replace everything from `<PageHeader title="Media Converter" {subtitle} icon="swap_horiz" />` down to (not including) `<style>` with:

```svelte
<ToolLayout title="Media Converter" {subtitle} icon="swap_horiz">
  {#snippet setup()}
    <SetupSection title="Files" status={inputStatus(batch)} tone={batchOk ? "ok" : "error" in batch && batch.error !== "checking" ? "warn" : "muted"}>
      <DropZone title="Audio or video files" filled={batchOk} disabled={converter.running} ondropped={drop}>
        {#snippet icon()}<span class="tile" aria-hidden="true"><Icon name="swap_horiz" size={26} /></span>{/snippet}
        {#if converter.files.length}
          <span class="zone-file">{converter.files.length} file{converter.files.length === 1 ? "" : "s"}</span>
        {:else}
          <span class="zone-hint" class:reselect={converter.pendingNames.length} data-testid="files-hint">{converter.pendingNames.length ? reselectHint(converter.pendingNames) : "Drop audio or video files here"}</span>
        {/if}
        {#snippet actions()}
          <button type="button" class="btn" disabled={converter.running} onclick={choose}>Choose Audio or Video Files…</button>
        {/snippet}
      </DropZone>

      {#if converter.files.length}
        <ul class="files" aria-label="Files to convert">
          {#each converter.files as entry (entry.key)}
            <li class:bad={entry.ok === false}>
              <label title={entry.file.name}>
                <input type="checkbox" value={entry.key} bind:group={converter.selected} disabled={converter.running} />
                <span class="name">{entry.file.name}</span>
                {#if entry.ok === false}<span class="tag">can't be used</span>{/if}
              </label>
            </li>
          {/each}
        </ul>
        <div class="row">
          <button type="button" class="btn" disabled={!converter.selected.length || converter.running} onclick={() => converter.removeSelected()}>Remove Selected</button>
          <button type="button" class="btn" disabled={!converter.selected.length} onclick={previewSelected}>
            <Icon name="play_arrow" size={18} /> Preview Selected
          </button>
        </div>
      {/if}

      {#if preview}
        <div class="preview">
          <div class="preview-head">
            <span class="name" title={preview.name}>{preview.name}</span>
            <button type="button" class="btn ghost" onclick={closePreview}>Close</button>
          </div>
          {#if previewError}
            <p class="status warn">This browser can't preview {preview.name}. It can still be converted.</p>
          {:else if preview.video}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video src={preview.url} controls playsinline onerror={() => (previewError = true)}></video>
          {:else}
            <audio src={preview.url} controls onerror={() => (previewError = true)}></audio>
          {/if}
        </div>
      {/if}

      {#if inputStatus(batch)}
        <p class="status" class:ok={batchOk} class:warn={"error" in batch && batch.error !== "checking"} data-testid="input-status" aria-live="polite">
          {inputStatus(batch)}
        </p>
      {/if}
    </SetupSection>
  {/snippet}

  {#snippet rail()}
    <RailBlock title="Export">
      <div class="stack">
        <div class="field-row">
          <span class="label">Detected media</span>
          <p class="value" data-testid="detected">{detectedLabel(batch)}</p>
        </div>
        <label class="label" for="convert-to">Convert to</label>
        <select id="convert-to" class="input" disabled={!batchOk || converter.running} bind:value={converter.format}>
          {#each formats as format (format)}
            <option value={format} disabled={!!UNAVAILABLE_FORMATS[format]} title={UNAVAILABLE_FORMATS[format] ?? ""}>
              {format.toUpperCase()}{UNAVAILABLE_FORMATS[format] ? " (not available)" : ""}
            </option>
          {/each}
        </select>
        {#if kind === "video" && formats.some((f) => UNAVAILABLE_FORMATS[f])}
          <p class="status hint">{UNAVAILABLE_FORMATS.avi}</p>
        {/if}
        {#if converter.format === "ogg"}
          <p class="status hint">OGG files use the Opus codec.</p>
        {/if}
        {#if kind === "audio" && converter.format === "mp3"}
          <label class="label" for="mp3-bitrate">MP3 bitrate</label>
          <select id="mp3-bitrate" class="input" disabled={converter.running} bind:value={converter.bitrate}>
            {#each MP3_BITRATES as bitrate (bitrate)}
              <option value={bitrate}>{parseInt(bitrate, 10)} kbps</option>
            {/each}
          </select>
        {/if}
        <span class="label" id="converter-export-label">Export folder</span>
        <ExportFolder folder={converter.folder} disabled={converter.running} downloads={CONVERTER_DOWNLOADS} labelId="converter-export-label" />
      </div>
    </RailBlock>
  {/snippet}

  {#snippet action()}
    <RailAction
      progress={converter.progress}
      running={converter.running}
      cancelling={converter.cancelling}
      warnings={converter.warnings}
      requirement={req}
      label="Convert Files"
      progressLabel="Conversion progress"
      onstatus={converter.lastJobId && !converter.running ? () => openHistory(converter.lastJobId) : null}
      onclear={() => {
        closePreview();
        converter.clear();
      }}
      oncancel={() => converter.cancel()}
      onstart={() => converter.convert()}
    />
  {/snippet}

  {#snippet after()}
    <RailError title="Conversion failed" failure={converter.failure} ondismiss={() => (converter.failure = null)} />
    <RailResults results={converter.results} savedTo={converter.savedTo} historyId={converter.lastJobId} />
  {/snippet}
</ToolLayout>
```

Then in the `<script>`:
- Remove the imports of `JobFooter`, `Modal`, `PageHeader`, `Section`.
- Add:

```ts
  import RailAction from "../../components/RailAction.svelte";
  import RailBlock from "../../components/RailBlock.svelte";
  import RailError from "../../components/RailError.svelte";
  import RailResults from "../../components/RailResults.svelte";
  import SetupSection from "../../components/SetupSection.svelte";
  import ToolLayout from "../../components/ToolLayout.svelte";
```

In `<style>`:
- Delete the rules `.columns`, `@media (min-width: 900px) { .columns … }`, `.column`, `.form`, `@media (max-width: 560px) { .form … }`, `.field`, `.value`, `select.input`, `pre`.
- Add:

```css
  .stack {
    display: grid;
    gap: 8px;
  }
  .stack .label {
    font-weight: 600;
    margin-top: 4px;
  }
  .field-row {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .value {
    margin: 0;
  }
  .stack select.input {
    width: 100%;
  }
```

- [ ] **Step 5: Run svelte-check**

Run: `npm run check`
Expected: 0 errors, 0 warnings. If svelte-check reports unused CSS selectors, delete those rules.

- [ ] **Step 6: Widen the page for tool routes (`src/ui/App.svelte`)**

Change the `<main>` element to carry a class for tool routes:

```svelte
  <main class="page" class:tool-route={["video-creator", "cutter", "converter", "stems"].includes(current.path)} id="main" tabindex="-1">
```

and add to the `<style>`:

```css
  .page.tool-route {
    max-width: 1440px;
  }
```

- [ ] **Step 7: Update existing e2e selectors for the Converter**

- `e2e/converter.spec.ts`: in `chooseFolder`, replace `page.getByRole("region", { name: "Output" })` with `page.getByRole("region", { name: "Export" })`.
- `e2e/history.spec.ts`: the two Converter/Video Creator folder clicks use `page.getByRole("region", { name: "Output" })`. Change only the **Converter** one (inside the "Load Job restores the Converter's format…" test, the line right after `selectOption("flac")`) to `{ name: "Export" }`. The Video Creator line changes in Task 7.

Run: `grep -n 'name: "Output"' e2e/converter.spec.ts e2e/history.spec.ts`
Expected: only `e2e/history.spec.ts` lines in the Video Creator part remain.

- [ ] **Step 8: Run the Converter-related e2e on all engines**

Run: `npx playwright test e2e/layout.spec.ts e2e/converter.spec.ts e2e/history.spec.ts e2e/a11y.spec.ts`
Expected: all pass (skips as before). If `a11y` flags `landmark-unique` or `region` rules, give the offending landmark a unique label and re-run.

- [ ] **Step 9: Visual check**

Run `npm run build && npx vite preview --port 4173`, screenshot `/#/converter` with a file added and after a conversion at 1440×900 (light and dark) and 390×844. Confirm the rail is about 25 % wide, sections breathe, and there's no horizontal overflow. Stop the preview server.

- [ ] **Step 10: Commit**

```bash
git add src/ui/tabs/converter src/ui/App.svelte e2e/layout.spec.ts e2e/converter.spec.ts e2e/history.spec.ts
git commit -m "feat: move the Media Converter to the setup + output rail layout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Release PR 1

**Files:** `package.json`, `package-lock.json`, `CHANGELOG.md`

- [ ] **Step 1: Bump and changelog**

Run: `npm version patch --no-git-tag-version`, then add at the top of `CHANGELOG.md` (below `## [Unreleased]`) with the new version and today's date:

```markdown
## [<new version>] - <YYYY-MM-DD>

### Changed
- New tool layout, starting with the **Media Converter**: setup on the left, and a sticky output panel on the right with export settings, the Convert button and progress, errors inline, and the finished files with a player and Download each. On phones the panel stacks below and the button stays in a bottom bar.
```

- [ ] **Step 2: Full verification**

Run: `npm run lint && npm run check && npm test && npx playwright test`
Expected: all pass.

- [ ] **Step 3: Commit, push, PR, CI, merge**

```bash
git add package.json package-lock.json CHANGELOG.md docs/superpowers
git commit -m "chore: release <new version>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feature/tool-layout
gh pr create --base main --title "feat: setup + output rail layout (Media Converter first)" --body "<Summary + Test plan; ends with 🤖 Generated with [Claude Code](https://claude.com/claude-code)>"
gh pr checks <n> --watch
gh pr merge <n> --merge --delete-branch
```

---

### Task 5: Migrate the Media Cutter

**Files:**
- Modify: `src/ui/tabs/cutter/state.svelte.ts`, `src/ui/tabs/cutter/MediaCutter.svelte`
- Modify: `e2e/cutter.spec.ts`, `e2e/cutter-preview.spec.ts`, `e2e/history.spec.ts`, `e2e/pwa.spec.ts` (selectors)
- Modify: `e2e/layout.spec.ts` (Cutter results test)

**Interfaces:**
- Consumes: Tasks 1–2; same pattern as Task 3.
- Produces: `cutter.results`, `cutter.savedTo`.

- [ ] **Step 1: Add the failing Cutter results test to `e2e/layout.spec.ts`**

```ts
test("the Cutter's rail lists every clip with a player", async ({ page, browserName }) => {
  if (browserName === "chromium") await mockFolderPicker(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/cutter");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("region", { name: "Source" }).getByRole("button", { name: "Choose…" }).click();
  await (await chooser).setFiles(golden("audio/short-10s-mono.wav"));
  await expect(page.getByTestId("source-status")).toHaveText("✓ Source audio ready.");
  await page.getByLabel("Duration for clip 1").fill("1");
  await page.getByRole("button", { name: "Add clip" }).click();
  await page.getByLabel("Start for clip 2").fill("2");
  await page.getByLabel("Duration for clip 2").fill("1");
  if (browserName === "chromium") await page.getByRole("region", { name: "Export" }).getByRole("button", { name: "Choose…" }).click();
  const download = browserName === "chromium" ? null : page.waitForEvent("download");
  await page.getByRole("button", { name: "Create Audio Clips" }).click();
  await download;
  await expect(page.getByTestId("progress-status")).toHaveText("Finished 2 clips", { timeout: 60_000 });
  const results = page.getByRole("complementary", { name: "Output" }).getByRole("list", { name: "Results" });
  await expect(results.getByRole("listitem")).toHaveCount(2);
  await expect(results.locator("audio")).toHaveCount(2);
});
```

Run: `npx playwright test e2e/layout.spec.ts --project=chromium -g "Cutter"`
Expected: FAIL (no region "Source").

- [ ] **Step 2: State changes in `src/ui/tabs/cutter/state.svelte.ts`**

Apply exactly the Task 3 Step 3 pattern:
- imports `AvailableOutput`, `jobResults`, `savedToLabel`;
- fields `results` and `savedTo`;
- `this.results = []` at the start of `create()` (after `this.warnings = [];`) and in `clear()`;
- replace `await this.record(jobId, source.file, clips, outputs, !!handle);` with:

```ts
      const record = await this.record(jobId, source.file, clips, outputs, !!handle);
      this.results = await jobResults(outputs, record).catch(() => []);
      this.savedTo = savedToLabel(!!handle, this.folder.ref?.name);
```

- replace `record()` with:

```ts
  private async record(id: string, source: File, clips: { title: string; start: number; duration: number }[], outputs: OutputRef[], directory: boolean): Promise<Record<string, unknown>> {
    const record = {
      id,
      tool: "clips" as const,
      created: localTimestamp(),
      source: { name: source.name, size: source.size, lastModified: source.lastModified },
      output: directory ? $state.snapshot(this.folder.ref) : { name: "Downloads" },
      clips,
      outputs: historyOutputs(outputs),
    };
    try {
      await addHistory(record);
      this.lastJobId = id;
      jobRecorded(id);
    } catch {
      // History is best effort (storage may be unavailable).
    }
    return record;
  }
```

- [ ] **Step 3: Re-compose `MediaCutter.svelte`**

Replace `<PageHeader title="Media Cutter" {subtitle} icon="content_cut" />` and the `<div class="columns">…</div>`, `<JobFooter …/>` and `<Modal title="Clip creation failed" …>…</Modal>` with the following, keeping the **inner content** of today's Input section (the DropZone, the player block and the timeline/transport) and today's Clip timestamps content verbatim:

```svelte
<ToolLayout title="Media Cutter" {subtitle} icon="content_cut">
  {#snippet setup()}
    <SetupSection title="Source" status={cutter.source?.ok ? (kind === "video" ? "Video" : "Audio") : ""} tone="ok">
      <!-- today's Input section content: DropZone + {#if cutter.source && sourceOk}player, preview-status, timeline, transport{/if} -->
    </SetupSection>
    <SetupSection title="Clips" status={clipError ?? clipStatus(resolved)} tone={resolved.error || clipError ? "warn" : "ok"}>
      <!-- today's Clip timestamps content: ClipTable, Add clip, clip-status -->
    </SetupSection>
  {/snippet}

  {#snippet rail()}
    <RailBlock title="Export">
      <div class="stack">
        <span class="label" id="clips-export-label">Export folder</span>
        <ExportFolder folder={cutter.folder} disabled={cutter.running} downloads={CLIPS_DOWNLOADS} labelId="clips-export-label" />
        {#if kind && cutter.format}
          <p class="status ok" data-testid="format-status">{outputFormatStatus(kind, cutter.format)}</p>
        {/if}
      </div>
    </RailBlock>
  {/snippet}

  {#snippet action()}
    <RailAction
      progress={cutter.progress}
      running={cutter.running}
      cancelling={cutter.cancelling}
      warnings={cutter.warnings}
      requirement={req}
      label={createLabel(kind)}
      progressLabel="Clip progress"
      onstatus={cutter.lastJobId && !cutter.running ? () => openHistory(cutter.lastJobId) : null}
      onclear={() => cutter.clear()}
      oncancel={() => cutter.cancel()}
      onstart={() => cutter.create()}
    />
  {/snippet}

  {#snippet after()}
    <RailError title="Clip creation failed" failure={cutter.failure} ondismiss={() => (cutter.failure = null)} />
    <RailResults results={cutter.results} savedTo={cutter.savedTo} historyId={cutter.lastJobId} />
  {/snippet}
</ToolLayout>
```

Replace the two HTML comments with the actual markup they describe, cut from the old sections (don't leave comments in the file).

Script changes:
- remove the imports of `JobFooter`, `Modal`, `PageHeader`, `Section` and `kindWord` (the "{Audio|Video} clip output" title is gone);
- add the six component imports listed in Task 3 Step 4.

Style changes:
- delete `.columns`, `.column`, `.form`, `.label`, `.field`, `pre` and their media queries;
- add the `.stack` rules from Task 3 Step 4.

- [ ] **Step 4: Update Cutter e2e selectors**

Run these replacements:

```bash
sed -i '' 's/getByRole("region", { name: "Input" })/getByRole("region", { name: "Source" })/' e2e/cutter.spec.ts e2e/cutter-preview.spec.ts e2e/pwa.spec.ts
sed -i '' 's#getByRole("region", { name: /clip output$/ })#getByRole("region", { name: "Export" })#' e2e/cutter.spec.ts e2e/history.spec.ts e2e/pwa.spec.ts
```

In `e2e/cutter.spec.ts`, replace `await expect(page.getByRole("region", { name: "Audio clip output" })).toBeVisible();` with:

```ts
  await expect(page.getByRole("region", { name: "Export" })).toBeVisible();
```

In `e2e/history.spec.ts`, inside `cutTwoClips`, the source picker uses `pick(page, "Choose…", …)`, which clicks the first "Choose…" on the page. That's still the Source drop zone (setup comes first in the DOM), so no change is needed.

In `e2e/a11y.spec.ts`, the cutter entry uses `pick(page, "Input", "Choose…", …)`; change `"Input"` to `"Source"` for the **cutter** entry only.

- [ ] **Step 5: Run Cutter e2e on all engines**

Run: `npx playwright test e2e/layout.spec.ts e2e/cutter.spec.ts e2e/cutter-preview.spec.ts e2e/history.spec.ts e2e/pwa.spec.ts e2e/a11y.spec.ts`
Expected: all pass.

- [ ] **Step 6: Visual check** (as Task 3 Step 9, on `/#/cutter` with a video source loaded and after creating clips).

- [ ] **Step 7: Commit**

```bash
git add src/ui/tabs/cutter e2e
git commit -m "feat: move the Media Cutter to the setup + output rail layout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Migrate the Stem Splitter

**Files:**
- Modify: `src/ui/tabs/stems/state.svelte.ts`, `src/ui/tabs/stems/StemSplitter.svelte`
- Modify: `e2e/stems.spec.ts`, `e2e/a11y.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `stemSplitter.savedTo`. `results` already exists; switch it to `jobResults`.

- [ ] **Step 1: Failing test**

In `e2e/stems.spec.ts`, change the results assertion in "splits vocals and instrumental…" from:

```ts
  await expect(page.getByRole("list", { name: "Stems" }).locator("audio")).toHaveCount(2);
```

to:

```ts
  const results = page.getByRole("complementary", { name: "Output" }).getByRole("list", { name: "Results" });
  await expect(results.locator("audio")).toHaveCount(2);
  await expect(results.getByRole("button", { name: "Download" })).toHaveCount(2);
```

Run: `npx playwright test e2e/stems.spec.ts --project=chromium -g "vocals and instrumental"`
Expected: FAIL.

- [ ] **Step 2: State**

In `src/ui/tabs/stems/state.svelte.ts`:
- import `jobResults`, `savedToLabel` from `"../../job-results"`;
- add `savedTo = $state("");`;
- replace the block that computes `this.results` (the `outputs.some((o) => o.file) ? … : (await resolveOutputs(record)).files` expression) with:

```ts
      this.results = await jobResults(outputs, record).catch(() => []);
      this.savedTo = savedToLabel(!!handle, this.folder.ref?.name);
```

- remove the now-unused `resolveOutputs` import (keep `isFolderRef`).

- [ ] **Step 3: Re-compose `StemSplitter.svelte`**

- Setup:
  - `SetupSection title="Source"`: the DropZone. The model status line moves to the rail.
  - `SetupSection title="Stems to export"`: the fieldset of checkboxes and the `stems-status` line.
- Rail:
  - `RailBlock title="Export"`, in this order: the model status line `<p class="model" data-testid="model-status">…</p>`, Output format, MP3 bitrate (when MP3), Export folder (`ExportFolder` with `downloads="Stems are saved to your browser's Downloads folder."` and `labelId="stems-export-label"`).
  - `action`: `RailAction` with today's `JobFooter` props.
  - `after`: `<RailError title="Stem splitting failed" failure={st.failure} ondismiss={() => (st.failure = null)} />` and `<RailResults results={st.results} savedTo={st.savedTo} historyId={st.lastJobId} />`.
- Delete:
  - the old "Stems" results section and its URL-management `$effect` (RailResults owns that now);
  - the `JobFooter` and `Modal`;
  - the `.columns`, `.column`, `.form`, `.results` and `pre` styles.
- Add the `.stack` styles from Task 3.
- Imports: drop `JobFooter`, `Modal`, `PageHeader`, `Section`; add the six components.

- [ ] **Step 4: e2e selectors**

In `e2e/stems.spec.ts`:

```bash
sed -i '' 's/getByRole("region", { name: "Input" })/getByRole("region", { name: "Source" })/; s/getByRole("region", { name: "Stems to export" }).getByRole("button", { name: "Choose…" })/getByRole("region", { name: "Export" }).getByRole("button", { name: "Choose…" })/' e2e/stems.spec.ts
```

Run: `grep -n '"Stems to export"' e2e/stems.spec.ts`
Expected: no lines contain `getByRole("button", { name: "Choose…" })` next to `"Stems to export"` any more.

- [ ] **Step 5: Run Stem Splitter e2e on all engines**

Run: `npx playwright test e2e/stems.spec.ts e2e/history.spec.ts e2e/a11y.spec.ts`
Expected: all pass.

- [ ] **Step 6: Visual check** (`/#/stems`, wide and 390 px, light and dark).

- [ ] **Step 7: Commit + Release PR 2** (as Task 4, changelog line: "The Media Cutter and Stem Splitter use the new layout too: results with players and Download in the output panel.")

```bash
git add src/ui/tabs/stems e2e
git commit -m "feat: move the Stem Splitter to the setup + output rail layout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Migrate the Video Creator

**Files:**
- Modify: `src/ui/tabs/video-creator/state.svelte.ts`, `VideoCreator.svelte`, `Output.svelte`, `LivePreview.svelte` (width only)
- Modify: `e2e/video-creator.spec.ts`, `e2e/render.spec.ts`, `e2e/history.spec.ts`, `e2e/a11y.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `vc.results`, `vc.savedTo`.

- [ ] **Step 1: Failing tests (`e2e/video-creator.spec.ts`)**

Replace the test "right column unlocks once audio and visual are valid" with:

```ts
test("effects, layers and post-effects stay disabled until audio and visual are valid", async ({ page }) => {
  await expect(page.getByLabel("Glitch", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Fade video in/out")).toBeDisabled();
  await ready(page);
  await expect(page.getByLabel("Glitch", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Fade video in/out")).toBeEnabled();
  await expect(page.getByText("Mute original video sound")).toHaveCount(0);
});
```

In `e2e/render.spec.ts`, after the first test's `info` assertions, add:

```ts
  const results = page.getByRole("complementary", { name: "Output" }).getByRole("list", { name: "Results" });
  await expect(results.locator("video")).toHaveCount(1);
```

Run: `npx playwright test e2e/video-creator.spec.ts e2e/render.spec.ts --project=chromium`
Expected: FAIL.

- [ ] **Step 2: State**

Same pattern as Task 3 Step 3, in `src/ui/tabs/video-creator/state.svelte.ts`:
- imports and fields `results`, `savedTo`;
- `this.results = []` in `generate()` after `this.warnings = [];`, and in `clear()`;
- replace `await this.record(jobId, effects, options, outputs, !!handle);` with:

```ts
      const record = await this.record(jobId, effects, options, outputs, !!handle);
      this.results = await jobResults(outputs, record).catch(() => []);
      this.savedTo = savedToLabel(!!handle, this.folder.ref?.name);
```

- change `record()` to build the record object (the same fields as today's `addHistory({...})` argument), then try `addHistory(record)`, `this.lastJobId = id`, `jobRecorded(id)` inside `try { … } catch {}`, and `return record;`. The return type is `Promise<Record<string, unknown>>`.

- [ ] **Step 3: Re-compose `VideoCreator.svelte`**

- Setup sections, in order:
  - **Audio**: the audio DropZone.
  - **Image or video**: the visual DropZone.
  - **Track timings**: `TrackTable` + `timestamps-status`; shown only when `vc.rows.length`; status = `"{n} track(s)"`.
  - **Effects**: `<EffectsList disabled={!downstreamReady} />`; status = `effectsSummary` when ready, else `"Choose audio and an image or video first"`.
  - **Layers**: `<Layers disabled={!downstreamReady} />`; status = `layersSummary` / the same hint.
  - **Post-effects**: today's Post-Effects form with each checkbox getting `disabled={!downstreamReady}`; status = `postSummary`.
- Rail:
  - `RailBlock title="Preview"` with `<LivePreview />`;
  - `RailBlock title="Export"` with `<Output disabled={!downstreamReady} tracks={tracks.options} />`;
  - `action`: `RailAction` with today's `JobFooter` props;
  - `after`: `<RailError title="Generation failed" failure={vc.failure} ondismiss={() => (vc.failure = null)} />` and `<RailResults results={vc.results} savedTo={vc.savedTo} historyId={vc.lastJobId} />`.
- **Keep** the "Detect drop start" and "Preview unavailable" `Modal`s (they aren't job failures).
- **Delete:**
  - the `leftOpen`/`rightOpen`/`previewOpen` state and the toggles;
  - every `Accordion` usage and its import;
  - the `JobFooter` and the "Generation failed" `Modal`;
  - `.columns`, `.column`, `.form`, `.label`, `.check`, `.row` and `pre` (keep `.zones`, `.thumb`, `.lead-in` rules).
- Add a `.post` form style:

```css
  .post {
    display: grid;
    gap: 10px;
  }
  .post .check {
    display: flex;
    gap: 8px;
    align-items: center;
  }
```

- [ ] **Step 4: `Output.svelte` stacks in the rail**

In `src/ui/tabs/video-creator/Output.svelte`'s `<style>`, add after the existing `.form` rule:

```css
  @container rail (max-width: 420px) {
    .form {
      grid-template-columns: 1fr;
      gap: 6px;
    }
    select.input {
      min-width: 0;
      width: 100%;
    }
  }
```

- [ ] **Step 5: e2e selector updates**

- `e2e/video-creator.spec.ts`:
  - in `choose()`, the region depends on the button. Replace the function body with:

    ```ts
    const region = /Folder|File/.test(String(button)) ? "Audio" : "Image or video";
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("region", { name: region }).getByRole("button", { name: button, exact: true }).click();
    await (await chooser).setFiles(files);
    ```

  - delete `openTimestamps`'s body. Replace it with `async function openTimestamps(_page: Page) {}` (sections are always open), or remove its calls with `sed -i '' '/await openTimestamps(page);/d' e2e/video-creator.spec.ts` and then delete the function;
  - remove every `await page.getByRole("button", { name: "Visual Effects" }).click();` and `await page.getByRole("button", { name: "Layers" }).click();` line:

    ```bash
    sed -i '' '/getByRole("button", { name: "Visual Effects" }).click();/d; /getByRole("button", { name: "Layers" }).click();/d' e2e/video-creator.spec.ts
    ```

  - in "starts with every requirement listed", delete the line asserting `"Audio timestamps"` is disabled;
  - in "Clear resets inputs and effects", replace `await expect(page.getByRole("button", { name: "Visual Effects" })).toBeDisabled();` with `await expect(page.getByLabel("Glitch", { exact: true })).toBeDisabled();`;
  - replace `getByRole("region", { name: "Output" })` with `getByRole("region", { name: "Export" })`.
- `e2e/render.spec.ts`:
  - replace `const input = page.getByRole("region", { name: "Input" });` and its `input.getByRole("button", { name: "Choose File…" })` / `{ name: "Choose…", exact: true }` uses with `page.getByRole("region", { name: "Audio" })` for "Choose File…" and `page.getByRole("region", { name: "Image or video" })` for "Choose…";
  - delete the clicks on `"Audio timestamps"`, `"Post-Effects"` and `"Output"`;
  - replace `getByRole("region", { name: "Output" })` with `getByRole("region", { name: "Export" })`.
- `e2e/history.spec.ts`: in the Video Creator part, apply the same "Input" → "Audio"/"Image or video" and "Output" → "Export" changes, and delete the `"Audio timestamps"` click.
- `e2e/a11y.spec.ts`: the video-creator entry picks with `pick(page, "Input", "Choose File…", …)` and `pick(page, "Input", "Choose…", …)`. Change these to `"Audio"` and `"Image or video"`, delete the `"Audio timestamps"` click, and make the "video-creator effects" entry just reuse `pages["video-creator"]` (no click).

Run: `grep -nE '"(Audio timestamps|Visual Effects|Post-Effects)"|name: "Input"|name: "Output"' e2e/*.ts`
Expected: no matches.

- [ ] **Step 6: Run all Video Creator e2e on all engines**

Run: `npx playwright test e2e/video-creator.spec.ts e2e/render.spec.ts e2e/history.spec.ts e2e/a11y.spec.ts e2e/layout.spec.ts`
Expected: all pass. The live-preview test's canvas size assertions (`304 × 540`) are unchanged, because the canvas resolution doesn't depend on the CSS width.

- [ ] **Step 7: Visual check** (`/#/video-creator` with audio + image, wide light/dark and 390 px; the preview fits the rail).

- [ ] **Step 8: Commit**

```bash
git add src/ui/tabs/video-creator e2e
git commit -m "feat: move the Video Creator to the setup + output rail layout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Clean up, document, Release PR 3

**Files:**
- Delete: `src/ui/components/JobFooter.svelte`, `src/ui/components/Accordion.svelte`
- Modify: `docs/specs/09-app-shell-and-about.md`, `CHANGELOG.md`, `package.json`

- [ ] **Step 1: Confirm nothing uses them, then delete**

Run: `grep -rln "JobFooter\|Accordion" src`
Expected: only the two component files themselves.

```bash
git rm src/ui/components/JobFooter.svelte src/ui/components/Accordion.svelte
```

- [ ] **Step 2: Spec 09**

Add a section **"Tool layout"** before `## Home` summarising the design:
- the 75/25 split with the 1440 px max and the rail clamp;
- always-open setup sections;
- the rail order;
- narrow screens: a stack plus the bottom bar;
- results with a player and Download;
- a link to `docs/superpowers/specs/2026-10-02-tool-layout-redesign-design.md`.

- [ ] **Step 3: Release**

Bump the patch version and add a changelog entry ("The Video Creator uses the new layout: live preview, export, Generate and results in the output panel; effects and layers are always visible."). Run the full verification (`npm run lint && npm run check && npm test && npm run test:gl && npx playwright test`), then commit, push, open the PR, wait for CI and merge, as in Task 4.

---

## Self-Review Notes

- **Spec coverage:**
  - Layout widths/grid → Task 2 (`ToolLayout`) and Task 3 Step 6.
  - Setup sections → Task 2 (`SetupSection`) and Tasks 3/5/6/7.
  - Rail order and blocks → Tasks 2/3/5/6/7.
  - Errors inline → `RailError`.
  - Results → Task 1 + `RailResults`.
  - Narrow screens → `ToolLayout` and the Task 3 e2e.
  - Accessibility → the axe runs in Tasks 3/5/6/7.
  - Removal of `JobFooter`/`Accordion` → Task 8.
  - Spec 09 → Task 8.
  - Rollout in three PRs → Tasks 4, 6 and 8.
- **Types:** `AvailableOutput` (from `io/history-outputs.ts`), `jobResults`, `savedToLabel`, `results`/`savedTo` and the `RailResults` props are named identically everywhere.
