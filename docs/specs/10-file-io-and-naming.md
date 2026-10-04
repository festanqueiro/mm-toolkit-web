# 10 — File I/O, Naming & Timestamps

## Timestamps

### `parseTimestamp(text) → seconds`

Port of `core.parse_timestamp`:

```
text = trim(value)
if empty → error "Timestamp cannot be empty."
parts = text.split(":")
if parts.length > 3 or any part (trimmed) !~ /^\d+(?:\.\d+)?$/ → error "Invalid timestamp: {value}"
3 parts → h, m, s;  2 parts → m, s;  1 part → s
if m >= 60 or (s >= 60 and parts.length > 1) → error "Invalid timestamp: {value}"
return h*3600 + m*60 + s
```

- Plain seconds can be ≥ 60 (`"195"` → 195).
- Hours are unbounded.
- No negatives.
- The error message embeds the **original untrimmed** value.

### `formatTimestamp(seconds) → "HH:MM:SS"`

`total = max(0, pyRound(seconds))`, then `HH:MM:SS` zero-padded to 2 digits each.

**`pyRound` is banker's rounding (round half to even).** JS `Math.round` rounds half up, so implement it explicitly:

| input | desktop output |
|---|---|
| 0.5 | `00:00:00` |
| 1.5 | `00:00:02` |
| 3599.5 | `01:00:00` |
| 3723.5 | `01:02:04` |
| -5 | `00:00:00` |

All cases: `fixtures/golden/golden.json → pure.formatTimestamp` / `pure.parseTimestamp`.

## Extensions & media kind

| Set | Values (lowercase, compare case-insensitively) |
|---|---|
| Audio in | `.wav .wave .aif .aiff .flac .mp3 .m4a .aac .ogg` |
| Image in | `.png .jpg .jpeg .webp .tif .tiff` |
| Video in | `.mp4 .mov .m4v .mkv .avi .webm` |
| Audio out | `mp3 wav aiff flac m4a aac ogg` |
| Video out | `mp4 mov mkv avi webm` |

`mediaKind(name)` → `"audio" | "video" | null`, by extension only. Validation then confirms the file actually decodes.

## Naming

- **`safeFilename(s)`**:
  - Replace each of `< > : " / \ | ? *` and control chars `\x00–\x1f` with `-`.
  - Then strip leading/trailing spaces and dots.
  - Empty → `Untitled`.
  - Example: `'Artist: Track?/Name'` → `'Artist- Track--Name'`.
- **Templates** use Python `str.format` field syntax. Port a **minimal formatter**:
  - Supports `{name}` and the escapes `{{` / `}}`.
  - An unknown field or a malformed brace is an error.
  - Allowed fields: promo `{track}`, `{number}`; clips `{source}`, `{title}`, `{number}`.
  - Format specs like `{number:02d}` **are** valid Python. Support `:0Nd` at least, and document anything else as unsupported.
- **`resolveOutput(name, policy, exists)`**:
  - `overwrite` → name.
  - `skip` → null if it exists.
  - `rename` → `stem (2).ext`, `stem (3).ext`, … first free.
  - Unknown policy → error `Unknown conflict policy: {p}`.
  - Golden: with `video.mp4` and `video (2).mp4` existing, rename → `video (3).mp4`.

## Where files come from

| Desktop | Web |
|---|---|
| `QFileDialog.getOpenFileName(s)` | `<input type=file [multiple] accept=…>`; `showOpenFilePicker` (Chromium, gives persistable handles); drag & drop (`DataTransferItem.getAsFileSystemHandle()` on Chromium) |
| `getExistingDirectory` (audio folder) | No folder picker: **Choose File(s)…** is a multi-select `<input type=file>` (spec 04). A dropped folder is read to **depth 1** for parity |
| Absolute path strings | `FileRef` objects (see [11](11-data-model-and-persistence.md)) |

## Where files go — the **Sink** abstraction

`io/sink.ts` exposes one interface to the engine:

```ts
interface OutputSink {
  exists(name: string): Promise<boolean>;            // for resolveOutput
  create(name: string): Promise<WritableStream<Uint8Array>>;
  remove(name: string): Promise<void>;               // partial-file cleanup on error/cancel
  finalize(): Promise<OutputRef[]>;                   // e.g. trigger download / close ZIP
}
```

Implementations:

1. **DirectorySink** (Tier 1). Wraps a `FileSystemDirectoryHandle` with `readwrite` permission. Honours the conflict policy exactly as desktop.
2. **DownloadSink** (Tier 2, single output). Writes to OPFS, then triggers a download (`<a download>` with a blob URL; revoke afterwards). The conflict policy doesn't apply: the browser handles duplicates.
3. **ZipSink** (Tier 2, batches, when "Batch download as ZIP" is on). Streams entries into a ZIP (`client-zip`). Applies `rename` semantics **within** the ZIP. Downloads `{tool} export {YYYY-MM-DD HH-MM}.zip`.
4. **OpfsMirror** (decorator). Also keeps a copy for History when "Keep copies of outputs" is on.

"Export folder is writable" maps to "the directory handle has `readwrite` permission". On reload, ask again with `requestPermission` from a user gesture. The status reads `Click to re-allow access to "{folder}".`

## Error/cancel cleanup

Desktop deletes the partial output on failure or cancel (`unlink(missing_ok=True)`). Every sink must implement `remove`. ZIP: drop the in-progress entry. Download: the download never starts.
