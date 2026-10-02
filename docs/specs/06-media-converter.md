# 06 — Media Converter

Port of `ui/converter_tab.py` + `core.convert_media`. Desktop subtitle: *"Convert batches of audio or video files into another common format."*

## Layout

Two columns.

**Input** (group): **Choose Audio or Video Files…** button · multi-select file list (tooltip = full name) · **Remove Selected** · **▶ Preview Selected** · status line.
Web additions: drag & drop onto the list; preview plays inline instead of opening the OS player.

**Output** (group, enabled only for a valid batch): **Detected media** (`Audio` / `Video` / `Not detected`) · **Convert to** (format combo) · **MP3 bitrate** (visible only for audio → MP3: 128 / 192 / 256 / **320 kbps**) · **Export folder** + status.

**Footer**: progress label (clickable → History) + bar. **Clear** | **Cancel** | requirements | **Convert Files**.

## Rules

- A batch must be **all audio or all video**. Mixed or unsupported → no output formats offered.
- The format list depends on the detected kind. **Keep the previous selection** if it's still valid, else select the first item.
  - Audio: `MP3 WAV AIFF FLAC M4A AAC OGG`
  - Video: `MP4 MOV MKV AVI WEBM`
- Output name: **`{source stem}.{format}`**. No template. Then `resolveOutput(conflictPolicy)`.
- Converting a file to its own format is allowed (re-encode).
- Files run sequentially.
- The export folder is prefilled from the Settings default.

## Messages

| Where | Text |
|---|---|
| Input status | `✓ {n} {audio|video} file{s} ready.` · `Audio and video files cannot be mixed in one batch.` · `One or more selected files cannot be used.` |
| Output status | `✓ Export folder is writable.` · `Export folder is not writable.` |
| Requirements | `To enable Convert: ` + [`choose a valid audio-only or video-only batch`, `choose a writable export folder`] |
| Ready | `✓ Ready to convert {n} file{s} to {FORMAT}{ at {N} kbps if mp3}.` |
| Running | `Converting files…` |
| Progress | `Preparing conversion…` · `Converting {name} ({i} of {n})` at `round(i/n*100)` · `Finished {n} conversion{s}` |
| Cancel | `Cancelling safely…` → `Conversion cancelled. Partial files were removed.` |
| Error dialog | `Conversion failed` |
| Engine errors | `Choose at least one media file.` · `Choose either audio files or video files, not a mixed selection.` · `{FMT} is not a supported {kind} output format.` · `Audio bitrate must be 128k, 192k, 256k, or 320k.` |

## Encoding matrix (desktop settings → web route)

| Out | Desktop | Web primary | Web fallback | Notes |
|---|---|---|---|---|
| **mp3** | libmp3lame, `-b:a {128..320}k` | WASM lame | `lamejs` | |
| **wav** | PCM s24le | TS writer | — | instant |
| **aiff** | PCM s24be | TS writer | — | instant |
| **flac** | flac | WASM | `libflac.js` | |
| **m4a** | AAC 256k | WebCodecs AAC → MP4 (audio-only) | WASM aac | |
| **aac** | AAC 256k | WebCodecs AAC → ADTS | WASM aac | |
| **ogg** | Vorbis q6 | WASM libvorbis | — | **Open decision (ADR-003):** keep Vorbis (WASM) or switch to Ogg/Opus (WebCodecs) |
| **mp4** | H.264 CRF18 fast + AAC 256k, yuv420p, faststart | WebCodecs H.264 + AAC → MP4 | WASM | |
| **mov** | same as mp4, faststart | WebCodecs → MOV | WASM | |
| **mkv** | H.264 CRF18 fast + AAC 256k | WebCodecs → MKV | WASM | |
| **avi** | MPEG-4 Part 2 q3 + MP3 VBR q2 | — | **WASM only (slow)** | **Open decision (ADR-004):** keep or drop AVI output |
| **webm** | VP9 CRF28 b:v 0 + Opus 192k | WebCodecs VP9 + Opus → WebM | WASM | VP9 encode is often software in browsers |

Video quality: use the [04](04-video-creator.md#output-and-encoding) mapping at "High" (≈ CRF 18). For WebM use "Standard" (≈ CRF 28 VP9).

### Web implementation (as built)

The job runs in `workers/job.worker.ts` (`engine/render/convert.ts`), each file through the shared `engine/render/transcode.ts` that the Media Cutter also uses:

- **Mediabunny `Conversion`** whenever it can read the source and write the target: MP3 (LAME WASM), WAV (`pcm-s24`), FLAC (WASM; a 16-bit FLAC source stays 16-bit), M4A/AAC (WebCodecs, else WASM), OGG, and every video target. First video + first audio stream, always re-encoded.
- **A streamed PCM pipeline** otherwise: AIFF sources (read by byte range), AIFF output (24-bit BE written in TS), and audio the page decoded with Web Audio.
- **Video**: MP4/MOV/MKV are H.264 at the "High" preset + AAC 256k; WebM is VP9 at "Standard" + Opus 192k. When the preferred codec can't be encoded, the next one the container allows, with a warning.
- **Undecodable audio** (a decoder that hangs, e.g. WebKitGTK's Vorbis): the stall watchdog stops the file, the Worker reports its index and the outputs already written, the page decodes that file with Web Audio, and the job resumes there. Nothing is converted twice.
- Progress also moves within a file: `round((i + fraction) / n * 100)`.
- **Inputs**: a batch is probed (container parses, has a stream of its kind). A file that fails (e.g. AVI, which Mediabunny can't read) shows "can't be used" in the list and the batch status `One or more selected files cannot be used.`
- **Preview Selected** plays the first selected file inline with the native player.

### Documented deviations

- **AVI output** is listed but disabled ("not available"): it needs MPEG-4 Part 2 + an AVI muxer (ffmpeg.wasm). Pending **ADR-004**.
- **OGG** is **Opus 192 kbps** (Vorbis q6 ≈ 192 kbps) until **ADR-003**.
- **Sample rates**: Opus is always encoded at 48 kHz; AAC keeps 44.1/48 kHz sources and resamples others to 48 kHz; FLAC keeps every rate the WASM encoder accepts (8–192 kHz standard rates) and otherwise resamples to an exact multiple (11.025 → 22.05 kHz) or the next rate up. Otherwise Mediabunny falls through to a native encoder, and WebKitGTK's writes broken FLAC. Native encoders misbehave at unusual rates (WebKit's Opus fails at 11.025 kHz; its AAC writes a config ADTS can't carry). Streamed with `StreamResampler`.
- The web **adds** picked files to the list (deduped) instead of replacing it, so a batch can be built from several folders.
- No WASM size ceiling is needed: the WASM encoders here are audio-only and stream, so the ffmpeg.wasm limit below doesn't apply until ffmpeg.wasm ships.

## Size limits

- **WebCodecs path**: streaming, so no hard ceiling beyond disk/OPFS quota.
- **WASM path**: refuse inputs over the configured ceiling (default 1.5 GB) with: `"{name}" is too large to convert in the browser ({size}). Try MP4/WebM output, or use the desktop app.`

## Persistence

None besides history (desktop doesn't persist converter inputs).

## History record

```json
{ "tool": "converter", "created": "…", "source": "<first ref>", "sources": ["<refs>"],
  "output": "<ref>", "format": "flac", "bitrate": "320k", "outputs": ["<refs>"] }
```
