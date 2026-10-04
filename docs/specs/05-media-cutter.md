# 05 — Media Cutter

Port of `ui/clips_tab.py` + `core.cut_media_clips`. Desktop subtitle: *"Cut audio or video into precisely timed clips. Use HH:MM:SS, MM:SS, or seconds. End is optional; duration defaults to 60 seconds."*

## Layout

Two columns (≈ 5 : 4).

**Left — Input** (group box)
- **Source media**: path row (audio + video extensions) and status.
- Video preview surface: shown only for video sources. 16:9 responsive, aspect kept, min 360×220.
- Waveform: shown only for audio sources (web only, see [Waveform clip regions](#waveform-clip-regions-web-only)).
- Timeline: seek slider + `HH:MM:SS / HH:MM:SS` label.
- Transport row: **▶ Play / Pause** · `Editing: {clip title}` label (bold) · stretch · **Set Start** · **Set End**.

**Right**
- **Clip timestamps** (group, stretches): table **Title** | **Start** | **End** | **Duration** | ▶ | 🗑, then **+ Add clip**, then a status line.
  - Title placeholder `Clip {NN}`. Start default `00:00:00`, placeholder `Required, e.g. 00:03:15`. End placeholder `Optional`. Duration default `60`, placeholder `60`.
  - ▶ tooltip "Play this clip". 🗑 tooltip "Remove this clip". Removing the last row adds a fresh empty one.
  - The current row is highlighted. Focusing any field in a row makes it current. The label shows `Editing: {title or Clip NN}`, or `Editing: select a clip` when no row is current.
- **Output** group, titled `{Audio|Video|Media} clip output`: **Export folder** + status.

**Footer**: progress label (clickable → History) + bar. **Clear** | **Cancel** | requirements | **Create {Audio|Video|Media} Clips**.

## Behaviour

- **Set Start / Set End** writes `formatTimestamp(playerPosition)` into the current row's Start/End. If no row is current, use row 0.
- **Clip preview ▶** seeks to start, plays, and stops at `start + duration`. Dragging the timeline, editing that row's timing, or toggling the button stops it.
- **Waveform handles** edit the same Start/End fields (see [Waveform clip regions](#waveform-clip-regions-web-only)).
- **Video first-frame priming**: desktop briefly plays muted to show the first frame after loading. Web: setting `currentTime = 0` and waiting for `loadeddata` is enough.
- **Clip resolution** (per row, `clip_request`):
  - Start is required, else `enter a start timestamp.`
  - If End is set: `duration = End − Start`. If ≤ 0: `End must be later than start.`
  - Else `duration = parseTimestamp(Duration or "60")`. If ≤ 0: `Duration must be greater than zero.`
  - Errors are reported as `Clip {n}: {error}`. The first failing row blocks the job.
  - Engine-side guard: `start < 0 || duration <= 0` → `Clip {n} has an invalid start or duration.`

## Messages

| Where | Text |
|---|---|
| Source status | `✓ Source audio ready.` / `✓ Source video ready.` · `The source media could not be found.` · `The selected file is not supported audio or video.` |
| Output status | `✓ {Audio|Video} clips will be exported as {FORMAT} files.` (video → `MP4`; audio → source extension uppercased, with `WAVE→WAV`, `AIF→AIFF`) · `Export folder is not writable.` |
| Clip status | `✓ {n} clip{s} ready.` or `Clip {n}: {error}` |
| Requirements | `To enable Create Clips: ` + [`choose valid source media`, `{clip error}`, `choose a writable export folder`] · `✓ Ready to create clips.` · `Creating clips…` |
| Progress | `Preparing clips…` · `Creating clip {i} of {n}` · `Finished {n} clip{s}` · `Cancelling safely…` · `Cancelled. Partial files were removed.` |
| Error dialog | `Clip creation failed` |

## Output formats (must match desktop)

- **Video source** → always **MP4**: first video stream + optional audio. H.264 (desktop: preset fast, CRF 18), yuv420p, AAC 256 kbps, `+faststart`. **Frame-accurate** (re-encoded, not stream-copied).
- **Audio source** → **same format as the source**:

| Source ext | Output | Codec settings |
|---|---|---|
| mp3 | `.mp3` | MP3 320 kbps CBR |
| wav / wave | `.wav` | PCM **24-bit LE** |
| aif / aiff | `.aiff` | PCM **24-bit BE** |
| flac | `.flac` | FLAC (default compression) |
| m4a | `.m4a` | AAC 320 kbps |
| aac | `.aac` | AAC 320 kbps (ADTS) |
| ogg | `.ogg` | Vorbis q8 |

- Only the first audio stream is used, and video is dropped for audio sources.
- Name: `clipTemplate` (Setting, default `{source} - {title}`) with `{source}` = stem, `{title}` = title or `Clip {NN}`, `{number}` = 1-based → `safeFilename` → extension → `resolveOutput`.
- Invalid template: `Invalid clip naming template. Use {source}, {title}, and {number}.`
- No clips: `Add at least one clip.`
- Bad source: `Choose a supported audio or video source.`

### Web implementation notes

The job runs in `workers/job.worker.ts` (`engine/render/clips.ts` over the shared `engine/render/transcode.ts`). Every clip is re-encoded like the desktop; Mediabunny's `Conversion` streams decode → trim → encode → mux with `tracks: "primary"` (first video + first audio stream).

- **WAV**: `pcm-s24` through Mediabunny's WAV muxer.
- **AIFF**: Mediabunny has no AIFF demuxer, so AIFF is read, sliced and written (24-bit BE) in TS (`engine/media/aiff.ts`).
- **AAC/M4A**: WebCodecs `AudioEncoder` where supported, else the WASM `@mediabunny/aac-encoder` (Firefox).
- **MP3**: WASM `@mediabunny/mp3-encoder` (LAME, like desktop FFmpeg), 320 kbps. **FLAC**: WASM `@mediabunny/flac-encoder`; a 16-bit source stays 16-bit (FFmpeg keeps the source depth), deeper sources become 24-bit. Always WASM, even where a native encoder is claimed: WebKitGTK's GStreamer MP3/FLAC encoders write short or broken files.
- **Undecodable audio**: some engines claim a decoder and then hang (WebKitGTK's Vorbis), and some only emit on flush (WebKitGTK's AAC), so no pre-flight probe is reliable. Instead a watchdog cancels a conversion that makes no progress for 15 s. For audio sources the Worker then reports the native rate and channel count; the page decodes the whole file with Web Audio at that rate (no resampling) and reruns the job from PCM. Video sources are re-cut once without audio, with a warning.
- **FLAC decode** uses a TS decoder (`engine/media/flac-decoder.ts`) in every engine: WebKit claims WebCodecs FLAC support but fails at runtime.
- **Video**: H.264 at the "High" bits-per-pixel preset from [04](04-video-creator.md#output-and-encoding) (source size and frame rate), since desktop exposes no quality control here. AAC 256 kbps. Where H.264 can't be encoded, VP9/AV1 in MP4 with a warning.
- **Progress**: `round((i + fraction) / n * 100)`, where `fraction` is the conversion's progress through the clip.

**Documented deviations**

- **OGG** clips are **Opus 256 kbps in Ogg**, not Vorbis q8: no Vorbis encoder exists for the web without ffmpeg.wasm. Interim until ADR-003 decides.
- Opus is encoded at 48 kHz, and AAC at 48 kHz unless the source is 44.1/48 kHz (see [06](06-media-converter.md#documented-deviations)).
- A clip whose start is at or past the end of the source fails with `Clip {n} starts after the end of {source}.` (FFmpeg would write an empty file). A clip running past the end is clamped, like FFmpeg `-t`.
- Odd video dimensions are rounded down to even for 4:2:0 (libx264 would refuse them).

### Preview playability

`<video>`/`<audio>` can't play every source in every browser (MKV/AVI generally, AIFF outside Safari, some Ogg in Safari). The native element is tried first; it counts as failed on an `error` event, or for video when metadata loads with no picture (`videoWidth === 0`). Then (`ui/tabs/cutter/players.svelte.ts`):

1. **Audio → chunked Web Audio.** Playback decodes ~10 s spans around the playhead in the Worker and schedules them back to back with Web Audio. The waveform (below) is drawn from this player's own peaks.
2. **Video → decoded frames.** Mediabunny `CanvasSink` draws the frame at the playhead (≤ 640 px wide) on a canvas, latest request wins. Playback follows the same chunked audio clock, with the soundtrack when it decodes.
3. If neither works: `This browser can't preview {name}. You can still type timestamps and create clips.`

While the fallback loads: `Preparing a preview of {name}…`. Without an audio output device (headless, muted systems) the clock falls back to wall time, as in the Video Creator's live preview. AIFF is read by byte range (header chunks + the span needed), so long AIFF mixes never load whole.

Cutting still works even when preview doesn't.

### Waveform clip regions (web only)

**Deviation from desktop**, which has no waveform. Every audio source shows one above the timeline (`ui/tabs/cutter/Waveform.svelte`; rules in `engine/clip-regions.ts`).

- **Peaks.** The media Worker streams the file once into min/max peaks (`peaks` op, 1200 columns; nothing held whole). When the native element plays the source, the peaks load after its metadata, **Worker only**: if the Worker can't decode the codec there is no waveform (the Web Audio route would hold the whole file decoded) and everything else works as before. The fallback audio player keeps its Web Audio last resort.
- **Loading.** An empty box of the waveform's size holds its place until the peaks arrive, so the controls below never jump.
- **Seek.** Click or drag the waveform to seek; the range input stays the accessible timeline.
- **Regions.** Each row that resolves to a clip starting inside the track is a shaded region, start → `min(start + duration, track end)`. Rows that don't resolve have none. Clicking inside a region makes its row current (and seeks); where regions overlap the current one keeps the click, else the later row wins.
- **Handles.** The current row's region is accent-coloured with a handle on each edge; with no current row, row 0 has them (like Set Start / Set End) and becomes current when moved. Moving a handle writes `formatTimestamp` of the position, so edges snap to whole seconds and a clip stays ≥ 1 s:
  - **Start**, row with an End: Start moves alone, at most 1 s before End.
  - **Start**, row using Duration: the clip slides (Duration is untouched), up to 1 s before the end of the track.
  - **End**: writes the End field (which then takes over from Duration), from 1 s after Start to the end of the track rounded up.
  - Moving a handle counts as editing that row's timing (it stops its clip preview). Handles don't move while a job runs.
- **Keyboard.** Handles are `role="slider"` named `Start of {clip title}` / `End of {clip title}`: ←/↓ and →/↑ move 1 s, with Shift 10 s.
- There is no zoom: on long sources drag to get close, then type the exact time.

## Persistence

`clips/source`, `clips/output` are saved on Create and removed on Clear. Clear also resets the table to one empty row and the export folder to the Settings default.

Web: only `clips/output` is saved for now. Sources aren't re-openable until input persistence lands (same as the Video Creator).

## History record

```json
{ "tool": "clips", "created": "…", "source": { "name": "…", "size": 0, "lastModified": 0 }, "output": "<ref>",
  "clips": [{ "title": "Intro", "start": 12.0, "duration": 30.0 }], "outputs": ["<refs>"] }
```

Loading a clips job restores rows as Title / Start (`formatTimestamp`) / End empty / Duration (`str(duration)`).

## Opportunity (not in desktop)

**Lossless cut** option: stream-copy packets (exact for most audio; keyframe-aligned for video). Very fast and no quality loss. Off by default.
