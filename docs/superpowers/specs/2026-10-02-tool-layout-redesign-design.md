# Tool layout redesign: setup + output rail

Date: 2026-10-02 · Status: approved design, awaiting spec review

## Intent

**Problem (from the user):** the tool pages feel **unbalanced and cramped**. Today each tool uses two roughly equal columns, the Video Creator hides most of its setup in accordions, and results are scattered: a footer progress line, files in a folder or Downloads, players only in the Stem Splitter, History as a separate tab.

**Outcome:** every tool reads as one clear flow. You configure on the left (75 %) and always see the preview, how the result will be exported, the action and the finished files on the right (25 %).

**Decisions made with the user:**

- Left: plain **scrollable sections, all open**. No accordions, no auto-scroll or step guidance ("free").
- Right: a sticky **output rail**: Preview → Export → action → errors → Results.
- Narrow screens: **stack** (rail blocks become sections below the setup) plus a slim **sticky bottom bar** with the action.
- Approach **A**: one shared layout and shared rail components for all four tools (not bespoke per tool, not CSS-only).

**Scope:** Video Creator, Media Cutter, Media Converter, Stem Splitter. Home, History, Settings and About keep their single-column layouts. Engines, workers, jobs and tool logic don't change.

## Layout

- Tool pages: max width **~1440 px** (other pages keep 1240 px).
- The page header (icon, title, subtitle) spans the full width.
- Grid `setup | rail`: rail `clamp(300px, 25%, 380px)`, setup takes the rest (~1000 px at 1440). Gap 20 px.
- The rail is `position: sticky` below the site header and scrolls internally when taller than the viewport (`max-height: calc(100vh − header − margins); overflow: auto`).
- **Under ~1000 px:** one column, setup sections first, then the rail blocks as normal sections. A slim sticky bottom bar holds the primary button, the progress status and bar, and Cancel. No horizontal overflow at 390 px.

## Setup column

- A stack of `SetupSection` cards: a heading (`h2`), an optional quiet status on the right (information only, e.g. `✓ 3 tracks`, `Checking…`), then the content. Always open.
- Sections per tool:

| Tool | Setup sections (in order) |
|---|---|
| Video Creator | Audio · Image or video · Track timings · Effects · Layers · Post-effects |
| Media Cutter | Source (drop zone + player/timeline + transport) · Clips |
| Media Converter | Files (drop zone, list, Remove/Preview Selected, inline preview) |
| Stem Splitter | Source · Stems to export |

- Controls are today's (drop zones, tables, effect stack), given more room: wider tables, the effect stack in a grid where it fits, fewer wrapped rows.
- The Cutter's player stays in setup (it is used to *set* times, not to preview the result).

## Output rail

Top to bottom; blocks a tool doesn't need are omitted.

1. **Preview**: Video Creator's live preview, sized to the rail width.
2. **Export**: the tool's output settings.

   | Tool | Export block |
   |---|---|
   | Video Creator | Video profile, frame rate, quality, audio bitrate, export folder, duration + job estimate |
   | Media Cutter | Export folder, format note (`✓ Audio clips will be exported as WAV files.`) |
   | Media Converter | Detected media, Convert to, MP3 bitrate, export folder |
   | Stem Splitter | Model status, output format, MP3 bitrate, export folder |

3. **Action** (`RailAction`, replaces `JobFooter`):
   - the requirements line while not ready;
   - the full-width primary button (labels unchanged);
   - while running, the status line (`data-testid="progress-status"`, a link to History when finished) with the progress bar and **Cancel**;
   - warnings as small notes;
   - a quiet **Clear** text button.
4. **Error** (`RailError`, replaces the failure `Modal`): an inline card with the existing title (`Generation failed`, `Clip creation failed`, `Conversion failed`, `Stem splitting failed`), the message, expandable *Details*, and a dismiss button. `role="alert"`.
5. **Results** (`RailResults`):
   - shown after a job finishes, and replaced by the next job's;
   - a header line: `Saved to {folder}` (Tier 1) or `Downloaded` (Tier 2), plus `Open in History`;
   - one row per output: name, size, a compact player (audio, or video for video outputs), and **Download** (always, even after the auto-download or folder save).

## Components (new, `src/ui/components/`)

| Component | Purpose | Interface |
|---|---|---|
| `ToolLayout.svelte` | Header + responsive `setup \| rail` grid; sticky rail; narrow-screen stacking + bottom bar | props `title`, `subtitle`, `icon`; snippets `setup`, `rail`, `bar` (bottom-bar content on narrow screens) |
| `SetupSection.svelte` | Section card | props `title`, `status?`, `statusTone?` (`ok`/`warn`); snippet `children` |
| `RailBlock.svelte` | A titled block in the rail (Preview, Export, Results) | props `title`; snippet `children` |
| `RailAction.svelte` | Requirements, primary button, progress, Cancel, warnings, Clear | same props as today's `JobFooter` (`progress`, `running`, `cancelling`, `warnings`, `requirement`, `label`, `progressLabel`, `onstart`, `oncancel`, `onclear`, `onstatus`) |
| `RailError.svelte` | Inline failure card | props `title`, `failure: {message, details} \| null`, `ondismiss` |
| `RailResults.svelte` | Results list with players and Download | props `results: AvailableOutput[]`, `savedTo: string`, `historyId: string \| null` |

- `RailResults` owns its object URLs (created on demand, revoked on change and destroy). It's generalised from the Stem Splitter's results list.
- Removed when unused: `JobFooter.svelte`, and `Accordion.svelte` (tool pages were its only users).

## Results data flow

- New helper `src/ui/job-results.ts`:
  - `jobResults(outputs: OutputRef[], record) → Promise<AvailableOutput[]>`: in-memory outputs directly (their `File`), otherwise `resolveOutputs(record)` (folder handles, kept OPFS copies).
  - This is the Stem Splitter's current logic, moved and shared.
- Each tool's state gains `results = $state.raw<AvailableOutput[]>([])` and `savedTo`, set when a job finishes **before** delivering staged downloads, and cleared on Clear and when a job starts.
- A staged copy may be cleared at the next app load when "keep copies" is off; the Results list is per session, so that's fine (History shows what still exists).

## Accessibility

- `SetupSection` uses `section` + `h2`; `RailBlock` uses `section` with `aria-labelledby`.
- The rail is an `aside` labelled "Output".
- Progress stays `aria-live="polite"`; `RailError` is `role="alert"`; players have accessible names (`Play {file}`).
- The axe audit (`e2e/a11y.spec.ts`) must stay at 0 violations.

## Testing

- **Keep** existing `data-testid`s, labels and button names wherever possible, so most e2e specs pass unchanged.
- **Update:**
  - specs that click accordion headers (`Audio timestamps`, `Visual Effects`, `Layers`, `Post-Effects`, `Output`, `Preview`, `Input`), since sections are always open;
  - region names where sections are renamed;
  - failure-dialog assertions → the inline error card.
- **New e2e:**
  - after a job, each tool shows Results with one row per output, a player and a Download that downloads;
  - on desktop the rail stays in view while the setup scrolls;
  - at 390 px the bottom bar shows the primary button and there is no horizontal overflow.
- Visual check of every tool in light, dark and at 390 px before each PR.

## Rollout

Three PRs, each with a patch bump and a CHANGELOG entry:

1. Shared components + `job-results.ts` + **Media Converter** migrated (proves the pattern).
2. **Media Cutter** and **Stem Splitter**.
3. **Video Creator**; remove `JobFooter`/`Accordion`; update spec 09 (layout section).

## Out of scope

Engine/worker changes, new tool features, History/Home/Settings/About layouts, visual rebranding.
