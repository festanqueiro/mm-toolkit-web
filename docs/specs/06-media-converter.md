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
