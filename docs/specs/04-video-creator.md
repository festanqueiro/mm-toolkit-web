# 04 — Video Creator

Port of `ui/video_creator.py` + `core.generate_videos` / `core.render_track`. Desktop subtitle: *"Turn audio plus an image or video into a new music video at the visual's native resolution."*

## Layout

The shared tool layout (spec [09 › Tool layout](09-app-shell-and-about.md#tool-layout-web-redesign-2026-10-02)). **Deviation from desktop**: desktop used two equal columns of accordions; the web shows every section open, in a setup column and an output rail.

**Setup column** (sections, in order)

1. **Image or video**: path row with **Choose…**, a 104×104 thumbnail (94×94 image, aspect kept; a video shows its first frame), and a status line.
2. **Audio**: path row with **Choose File(s)…**. Status line below. Section status: `✓ {n} track(s)`. **Deviation from desktop**: desktop listed Audio first; the web asks for the image or video first (order only: either can be chosen at any time, and the requirements line keeps the desktop's order). Desktop also had **Choose File…** (one file) and **Choose Folder…**; the web has one multi-select button. Several picked files are listed like a folder's (audio extensions only, case-folded name order) and the row shows `{n} files`. Dropping a folder still works (hint: `Drop audio files or a folder here`).
3. **Track timings** (shown once audio is found; section status `{n} track(s)`)
   - Table, one row per track: **Audio** (file name, tooltip = full name) | **Start** (text field, placeholder `HH:MM:SS`, default `00:00:00`, plus ✨ button) | **Duration** (number, 1–3600 s, 1 decimal, suffix ` s`, default 60) | **▶/■** preview.
   - Status line under the table (see Messages).
   - Table style: alternating rows, no grid, hidden row header, rounded 8 px border, bold header. Same style as the Media Cutter table.

4. **Effects**: the hint *"Drag rows to change the order effects are applied in."*, then a drag-reorderable list. Each row: ☰ handle (tooltip "Drag to reorder"), an enable checkbox, and a per-effect control:

   | Row (default order) | Label | Control | Default |
   |---|---|---|---|
   | overlay | Overlay | slider 0–100 % (opacity) | off, 100 % |
   | bass_blur | Bass-reactive Blur | — | **on** |
   | rotate | Rotate | number 0.1–200.0, suffix ` RPM` | off, 33.3 |
   | vhs | VHS | slider 0–100 % | off, 50 % |
   | glitch | Glitch | slider 0–100 % | off, 50 % |

   A row's control is enabled only while its checkbox is checked. Backlog: make the hint colour legible in both themes (desktop used `palette(mid)`, which reads near-black).
5. **Layers**
   - **Background**: **Fill** [Solid color | Image]. Solid shows a **Color** swatch button labelled `#rrggbb` (default `#19191d` = rgb 25,25,29). Image shows an **Image** picker. Only the row for the current mode is visible, label included. Backlog: put the swatch on the same row as Fill; add an enable/disable checkbox (off by default).
   - **Overlay**: **Image** picker (png/jpg/jpeg/webp/tif/tiff).
6. **Post-effects**
   - Checkbox "Mute original video sound" (default on). **Visible only when the visual is a video.**
   - "Fade video in/out" (default on).
   - "Fade audio in/out" (default on).

Sections 4–6 show a quiet status: the enabled effect chain, the background (+ overlay), the fades; or `Choose audio and an image or video first`.

**Output rail**

1. **Preview** (see [Live preview](#live-preview-new)).
2. **Export**
   - **Export folder** + status (see [10](10-file-io-and-naming.md)).
   - **Video profile**: Visual native | Vertical 1080 × 1920 | Square 1080 × 1080 | Landscape 1920 × 1080.
   - **Frame rate**: 12–60, default 24.
   - **Quality**: see [Output and encoding](#output-and-encoding). Replaces desktop "Quality (CRF)" + "Encoding speed".
   - **Audio bitrate**: 128k | 192k | 256k | **320k**.
   - **Estimated duration** and **Job estimate** (read-only).
3. **Action**: requirements text, **Generate Video(s)**, a progress status (clickable once outputs exist → opens History with the latest job selected) with a progress bar and **Cancel** while running, and **Clear**.
4. **Generation failed** card (inline, replaces desktop's dialog), then **Results**: each video with a player and **Download**.

### Enablement

- *Track timings* appears when ≥1 audio file was found; its inputs are disabled while a job runs.
- The controls in *Effects*, *Layers*, *Post-effects* and *Export* are enabled when audio and visual are both valid and no job is running.
- While a job runs, every input is disabled and any preview stops.
- During drop analysis, every ✨ button is disabled and Generate is blocked.

## Inputs

- **Audio**: one or more files, or a folder. A folder takes its **direct children only (not recursive)** with an audio extension (`.wav .wave .aif .aiff .flac .mp3 .m4a .aac .ogg`, case-insensitive), **sorted by name, case-insensitive**. Web: the picker selects files (several at once, filtered and sorted the same way); a folder arrives by drag & drop only.
- **Visual**: an image (`.png .jpg .jpeg .webp .tif .tiff`) or a video (`.mp4 .mov .m4v .mkv .avi .webm`). Image validation must actually decode it. Video validation must decode its first frame.
- **Picker start location**: desktop opens the visual, background and overlay pickers in the audio file's folder. Web (Chromium): pass `startIn` = the audio `FileSystemHandle`. Other browsers: no equivalent, so skip.

### Implementation notes (web)

- **Pickers.** A transient `<input type=file>` works in every engine. Folder drops read the dropped directory's direct children. Handle-based pickers (persistable on Chromium) arrive with input persistence.
- **Decoding** (`engine/media/audio-decode.ts`, in `workers/media.worker.ts`):
  - Native sample rate, stereo-ised and 16-bit quantised like the desktop's FFmpeg step.
  - Mediabunny for WAV/MP3/AAC/M4A/FLAC/OGG, plus a TS reader for AIFF/AIFF-C (Mediabunny has no AIFF demuxer).
  - If WebCodecs can't decode a codec, the client falls back to the main thread's `decodeAudioData`, resampled to 44.1 kHz. Drop times on that path can differ slightly.
- **Visual validation** (`io/visual.ts`):
  - Images: `createImageBitmap`.
  - Videos: Mediabunny's first frame via WebCodecs.
  - Same messages as desktop.
  - Note: WebKit/Firefox on macOS refused a 64×48 VP9 test clip (320×240 decodes fine), so the fixture is 320×240.
- **Export folder requirement:**
  - Tier 2 browsers export to Downloads, so they never show "choose a writable export folder".
  - Tier 1 needs a folder. For now that's the Settings default; the Output section's picker comes next.

## Per-track timing

- Each row's **Start** accepts `parseTimestamp` formats ([10](10-file-io-and-naming.md#timestamps)). **Duration** is seconds.
- When the audio selection changes, rows are rebuilt, but **existing rows keep their start/duration**, keyed by file identity.
- **Preview ▶** plays the track from `start` for `duration` seconds. Only one plays at a time. Clicking the playing row's button stops it. Editing that row's start or duration stops it.
  - Tooltip: `Listen from {start or 'the start time'} for {duration:g} seconds`.
  - Status: `Listening to {name} from {HH:MM:SS} for {duration:g} seconds.`
  - An invalid start shows a "Preview unavailable" alert with the parse error.
  - Web: use an `AudioBufferSourceNode.start(0, start, duration)` on the decoded PCM. This is sample-accurate and works for every decodable format.

### Drop detection (✨ per row)

1. The dialog **"Detect drop start"** says: *"MM Toolkit will analyze {track} and propose a start time based on its main drop."* Field **"Start before the drop"**: 0.0–60.0 s, step 0.5, 1 decimal, suffix ` seconds`. Defaults to the last value used (persisted `promo/drop_lead_in`, initial 2.0). Buttons: Cancel / **Analyze**.
2. Running state: status `Analyzing {name} for its main drop…`. All ✨ disabled. Generate blocked with "wait for drop analysis".
3. Success: set that row's Start to `formatTimestamp(max(0, drop − leadIn))`. This **rounds to whole seconds with banker's rounding**; see [10](10-file-io-and-naming.md#timestamps). Status: `✓ Proposed {HH:MM:SS} for {name}. You can edit or preview it.`
4. Failure: `Drop detection failed: {message}. You can still enter the start manually.`
5. Only one analysis may run at a time.

## Messages (exact strings, keep them)

| Where | Condition | Text |
|---|---|---|
| Audio status | n ≥ 1 | `✓ Found {n} audio file{s}.` |
| Audio status | path set, none found | `No audio files were found.` |
| Visual status | ok | `✓ Image ready.` / `✓ Video ready.` |
| Visual status | errors | `The image could not be found.` · `The selected file is not a supported image.` · `The selected artwork could not be read.` · `The video could not be found.` · `The selected video could not be read.` · `The selected file cannot be used as an image or video.` |
| Timestamps status | tracks present, idle | `Edit start times manually or use ✨ to detect a drop for one track.` |
| Requirements | missing items | `To enable Generate: ` + `; `-joined from [`choose audio`, `choose a valid image or video`, `choose a writable export folder`, `Track {n}: {parse error}`, `wait for drop analysis`] + `.` |
| Requirements | ready | `✓ Ready to generate videos.` |
| Requirements | running | `Generating videos…` |
| Generate button | 1 track / many | `Generate Video` / `Generate Videos` |
| Estimated duration | equal durations | `{HH:MM:SS} per video • {HH:MM:SS total} combined` |
| Estimated duration | differing | `{min}–{max} per video • {total} combined` |
| Estimated duration | no tracks | `Select audio to estimate duration.` |
| Job estimate | tracks | `{n} output(s) • {X.X} GB free` → web: use `navigator.storage.estimate()` when exporting via OPFS, else just `{n} output(s)` |
| Job estimate | none | `Select audio to estimate this job.` |
| Progress | start | `Preparing…` |
| Progress | per track | `Analysing {name}` at `round(i/n*100)`; `Rendering {name}` at `round((i + frac)/n*100)` |
| Progress | done | `Finished {n} video{s}` |
| Progress | cancel requested | `Cancelling safely…` |
| Progress | cancelled | `Cancelled. Partial files were removed.` |
| Error dialog | failure | title `Generation failed`, message + expandable details |

## Render pipeline (per track)

Port of `render_track`. Runs in the job Worker.

1. **Decode + normalise** the audio (see [02](02-audio-analysis.md#input-normalisation)).
2. **Start time**: the per-row value. The UI always supplies one. The engine still supports `start = null` → `max(0, detectDropTime − 2.0)` (`pre_drop`) for API parity.
3. **Snippet**: samples `[start, start + duration)`, clamped to the track end. `actualDuration = min(duration, snippetLength)`. If `actualDuration <= 0`, fail with `{name} contains no usable audio.`
4. **Envelope**: only if Bass-reactive Blur is enabled: `buildBassEnvelope(snippet, fps, actualDuration)`.
5. **Visual**
   - **Canvas size**: the profile size. For *Visual native*, the visual's size **rounded down to even** width and height (H.264 4:2:0 needs even dimensions; at most one edge pixel is cropped).
   - **Background**: `buildBackgroundFrame(canvas, background)`.
   - **Image**: for a profile, **contain-fit** (Lanczos) centred on the background frame. Native: crop to even.
   - **Video**: frame at `t mod videoDuration` (looping), fitted the same way. A visual with no duration fails with `{name} contains no usable video.`
   - **Overlay**: only if enabled and an image is set: `loadOverlayImage(file, canvas)`.
6. **Per frame** at `t = i / fps`: check cancel → visual frame → `applyEffectChain(frame, t, effects, background, envelope?[min(floor(t·fps), len−1)], overlay?)` → video fade.
7. **Audio**: snippet with the audio fade. If the visual is a video **with** an audio track **and** "Mute original video sound" is off, loop the video's audio to `actualDuration` and **sum** it with the music. The fade applies to the music only.
8. **Encode** H.264 4:2:0 + AAC (`audioBitrate`) → **.mp4** with `fastStart`. Stream to the sink.
9. On error: delete the partial output and re-raise. On cancel: delete the partial output.

### Implementation notes (render)

- `engine/render/promo.ts` runs in `workers/render.worker.ts`. Still visuals use the Pillow-exact CPU fit once per track. Video visuals are fitted per frame with the 2D scaler (visual-only parity) and read through `canvasesAtTimestamps` with all frame times known up front.
- **No WebGL in Workers** (WebKitGTK, older Safari): the render falls back to the CPU reference effects. They're bit-exact, but much slower, and a warning is shown.
- **Frames**: `ceil(duration × fps)` (moviepy's `np.arange(0, duration, 1/fps)`).
- **Audio** is resampled to **44.1 kHz** like moviepy's `audio_fps` (windowed sinc), then encoded as AAC. Without an AAC encoder (Firefox) it's Opus at 48 kHz, with a warning.
  - The original video sound (when not muted) is looped, summed with the faded music and clipped.
- **Video codec**: H.264 first (Chrome, Safari and Firefox all output limited-range `yuv420p`). The fallbacks are VP9, then AV1, in MP4, with a warning.
- **Destinations**:
  - Tier 1 writes into the chosen folder with the conflict policy. The live handle is used; IndexedDB only after a reload.
  - Tier 2 stages in OPFS, then downloads, or ZIPs batches.
  - Without OPFS (Safari private browsing), outputs stay in memory and download from there.
  - Staged copies are deleted when the **next** job starts or on load, never right after `a.click()`. That would cancel the download, which reads the file lazily.
- **Cancel** is checked before each frame. A partial output is never written: the MP4 is finalised in memory before it reaches the sink.
- On success the job is added to History (newest 20) and, if enabled, sends the notification "Promo video finished" / "Created {n} file{s}.". A `beforeunload` guard and a Screen Wake Lock are held while a job runs.

### Batch (`generate_videos`)

- Tracks run sequentially.
- Output name: `namingTemplate` (Setting, default `{track} - Promo Snippet`) formatted with `{track}` = file stem and `{number}` = 1-based index → `safeFilename` → `.mp4` → `resolveOutput(conflictPolicy)`. **Skip** means the track isn't rendered.
- An invalid template fails the job: `Invalid promo naming template. Use {track} and optionally {number}.`
- No audio files: `No audio files were provided.`

## Output and encoding

The desktop uses libx264 with **CRF 14–30 (default 18)** and **preset ultrafast/fast/medium/slow (default medium)**, `yuv420p`, threads ≤ 4. WebCodecs has neither, so this is a **documented deviation**:

- Replace both controls with **Quality**: `Maximum` · **`High` (default)** · `Standard` · `Small`.
- Map each to WebCodecs settings:
  - `bitrateMode: "variable"`, `latencyMode: "quality"`, and `bitrate = width × height × fps × bpp`.
  - Starting bpp values: Maximum 0.20 · High 0.12 · Standard 0.07 · Small 0.04.
  - **Calibrate in the Phase 0 spike** so High looks comparable to desktop CRF 18. Where `bitrateMode: "quantizer"` is supported, map to a per-frame QP instead (≈ CRF).
- Pick the **H.264 level** from the frame size and fps (e.g. `avc1.640028` covers 1080p30; use 4.2/5.x for 1080p60 or larger native sizes).
- If the encoder rejects a native size (some hardware caps at 4096 px), **scale down** to the largest supported size (keep aspect, even dimensions) and warn the user.
- **AAC unavailable** (e.g. Firefox): encode the audio with ffmpeg.wasm AAC. If WASM is unavailable too, offer Opus-in-MP4 with a warning: "Some platforms may not accept Opus audio."

## Live preview (new)

Implemented as the **Preview** block at the top of the output rail, so it stays visible while effects are edited. It has ▶/⏸, a position slider and, with several tracks, a Track picker.

- **Seeking.** The slider is the snippet's seek bar (`0` → its duration, one frame per step). Play starts from the slider position, on a frame boundary: audio, picture, bass envelope and fades are all taken at that offset, so the preview at `t` equals the render at `t`. Moving the slider while playing holds playback and shows the frame under the thumb; releasing it (or an arrow key) carries on from there.
- **Pause** keeps the position and Play resumes from it. When the snippet ends the position stays at the end; Play from the last frame starts over.
- The snippet's audio is decoded once and reused until the track, its Start or its Duration changes.

- Effects run through the same `GlEffectRenderer` as the render, and bass strength comes from the snippet's envelope, computed in the Worker.
- Layer fitting uses the browser's 2D canvas scaling at preview size, not the Pillow-exact CPU path. That's fast, and identical to the eye.
- Pixel-sized effects (VHS channel shift, scanlines) look slightly stronger on the smaller canvas.
- Original video audio isn't mixed into the preview yet.

- A preview canvas shows the visual with the full cascade, Layers and fades applied. It plays along with the selected row's audio snippet.
- Uses the same GL effect code as the renderer, at reduced resolution (e.g. longest edge 540 px). Bass strength comes from the **precomputed** snippet envelope (not a live `AnalyserNode`), so preview equals render.
- Updates live as effect settings change. Stops when a job starts.

## Persistence

Saved when generation starts. Restored on load. Removed by **Clear**.

| Key | Value |
|---|---|
| `music`, `cover`, `output` | file/folder references ([11](11-data-model-and-persistence.md)) |
| `promo/video_fade`, `promo/audio_fade`, `promo/mute_original_video_audio` | bool |
| `promo/effects_state` | effects JSON (schema in [11](11-data-model-and-persistence.md#effects-state)) |
| `promo/drop_lead_in` | number (saved on Analyze; Clear does not reset it) |

**Clear** resets: paths (export folder → Settings default), effects (default order and values), fades on, mute on, profile Visual native, fps 24, quality default, bitrate 320k, progress hidden.

## History record (on success)

```json
{
  "tool": "promo",
  "created": "2026-10-02T14:03:11",
  "source": "<audio file or folder ref>",
  "cover": "<visual ref>",
  "output": "<export folder ref>",
  "bass_effect": true,
  "effects": { "...": "effects state, see 11" },
  "video_fade": true,
  "audio_fade": true,
  "mute_original_video_audio": true,
  "tracks": [{ "path": "<ref>", "start": 43.0, "duration": 60.0 }],
  "fps": 24,
  "profile": [1080, 1920],
  "outputs": ["<output refs>"]
}
```

`profile` is `null` for Visual native. Web additions (optional): `quality`, `audio_bitrate`.
