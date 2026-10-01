# 07 — History

Port of `ui/history_tab.py` and the history parts of `main_window.py`. Desktop subtitle: *"Recent jobs are stored only in your local application settings."* Web wording: *"Recent jobs are stored only in this browser."*

## Data

- Up to **20** records, **newest first** (insert at index 0, truncate to 20).
- Record schemas are defined per tool in [04](04-video-creator.md#history-record), [05](05-media-cutter.md#history-record) and [06](06-media-converter.md#history-record).
- Common fields: `tool` (`promo` | `clips` | `converter`; keep `promo` for Video Creator, as desktop does), `created` (local ISO timestamp, seconds precision), `source`, `output`, `outputs`.
- Storage: IndexedDB (see [11](11-data-model-and-persistence.md)).

## Layout

**Left**: job list. Each item reads `{created}  •  {Video Creator|Media Cutter|Media Converter}  •  {source name or "Unknown input"}`. Actions: **Clear History** · stretch · **Show Output Folder** · **Load Job**. Actions are disabled when the list is empty.

**Right**: "Rendered files" list (max ~110 px tall) · preview surface (video only) · transport (▶, seek, time) · status line.

## Behaviour

- On refresh, keep the selected job if it still exists (key = `created` + `tool` + `source`). Otherwise select the newest.
- Selecting a job lists only the outputs **still available**:
  - Tier 1: output file handles that still resolve.
  - All tiers: outputs whose OPFS copy is still kept (see below).
  - Status: `No rendered files found for this job.` / `Select a job to preview its rendered files.`
- Selecting an output loads it into the inline player.
- **Load Job** restores that tool's form and switches to its tab:
  - Video Creator: paths, effects state (or the legacy `bass_effect` flag if there's no `effects`), fades, mute, per-track start/duration matched by track identity, fps, profile. Status `✓ Loaded saved per-track timings.`
  - Media Cutter: source, output, clip rows.
  - Converter: files, output, format, bitrate.
  - **Web limitation:** source files can only be restored where a persisted handle exists (Chromium) and permission is re-granted. Otherwise the form is restored and each missing input shows a "Re-select {name}" prompt.
- **Show Output Folder** has no web equivalent; a page can't reveal a folder in Finder/Explorer. Replace with:
  - Tier 1: **"Open export folder"**, which re-requests permission on the directory handle and lists its files in-app.
  - All tiers: **"Download again"** for outputs kept in OPFS.
- **Clear History** removes all records (and, optionally, their OPFS copies after confirmation).

## Output retention (web-specific)

Outputs saved to Downloads can't be read back later. To keep History previews working on Tier 2, offer the Setting **"Keep copies of outputs for History"** (default **off**, to protect storage quota). When on, outputs are also written to OPFS and evicted oldest-first beyond a size cap (default 2 GB). The setting shows current usage.

## Completion signals (from `main_window`)

On each finished job:

1. Add the record to history and refresh the list.
2. If Settings → Notifications is on, send a notification:
   - Title: `{Promo video|Clips|Conversion} finished`.
   - Body: `Created {n} file{s}.`, or `Finished.` if there are no outputs.
   - Web: Notifications API, with permission requested the first time the setting is enabled. Clicking it focuses the tab and selects the latest job, **without switching tabs** (desktop behaviour).
3. If the History tab isn't active: increment the unread badge. The tab label becomes `History ({n})` with the `notifications` icon. Opening History resets it. Web extra: `navigator.setAppBadge(n)` when installed as a PWA.
4. The tool's progress label becomes a link that opens History with the latest job selected.
