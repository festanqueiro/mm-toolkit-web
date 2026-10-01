# 11 — Data Model & Persistence

Desktop uses `QSettings("MM Toolkit", "MM Toolkit")`. The web app uses **IndexedDB** (one database, `mm-toolkit`). Small scalar settings may be mirrored to `localStorage` for synchronous first paint. **All key names stay identical to desktop**, so a future "import desktop settings/history" (JSON) is trivial.

## Stores

| Store | Contents |
|---|---|
| `settings` | key → JSON value (all keys below) |
| `history` | `{id, ...record}`, newest first, max 20 |
| `handles` | `FileSystemHandle`s keyed by `FileRef.id` (Chromium only; handles are structured-cloneable) |

## Settings keys (complete list from desktop)

| Key | Type | Default | Owner |
|---|---|---|---|
| `general/default_output` | FileRef (dir) | — | Settings |
| `general/notify_finished` | bool | `true` | Settings |
| `general/promo_naming` | string | `{track} - Promo Snippet` | Settings |
| `general/clip_naming` | string | `{source} - {title}` | Settings |
| `general/conflict_policy` | `rename`\|`overwrite`\|`skip` | `rename` | Settings |
| `music` | FileRef (file or dir) | — | Video Creator |
| `cover` | FileRef | — | Video Creator |
| `output` | FileRef (dir) | — | Video Creator |
| `promo/video_fade` | bool | `true` | Video Creator |
| `promo/audio_fade` | bool | `true` | Video Creator |
| `promo/mute_original_video_audio` | bool | `true` | Video Creator |
| `promo/effects_state` | JSON string (below) | — | Video Creator |
| `promo/drop_lead_in` | number | `2.0` | Video Creator |
| `clips/source` | FileRef | — | Media Cutter |
| `clips/output` | FileRef (dir) | — | Media Cutter |
| `history/jobs` | (desktop: JSON array) | `[]` | → the `history` store on web |

Web-only: `web/zip_batches` (bool, true), `web/keep_output_copies` (bool, false), `web/wasm_large_inputs` (bool, false), `web/theme` (`system`).

## FileRef

Paths don't exist in the browser. Wherever desktop stores an absolute path string, the web stores a **FileRef**:

```ts
type FileRef = {
  id: string;              // uuid; key into the `handles` store when a handle exists
  name: string;            // display name, e.g. "track.wav" or "Promo exports"
  kind: "file" | "directory";
  size?: number; lastModified?: number;   // used to match a re-selected file to the old ref
  hasHandle: boolean;      // true only on Chromium when a FileSystemHandle was persisted
};
```

Restore flow:
- `hasHandle` → `queryPermission`, then `requestPermission` on the next user gesture.
- Otherwise the UI shows the name plus a "Re-select" button.

Track identity for per-track timings (desktop: the path) becomes `name + size + lastModified`.

In-session `File` objects (from `<input>`) live only in memory. They are **not** persisted.

## Effects state

Identical to desktop `EffectsPanel.state_dict()`:

```json
{
  "order": ["overlay", "bass_blur", "rotate", "vhs", "glitch"],
  "overlay":   { "enabled": false, "opacity": 1.0, "media_path": null },
  "bass_blur": { "enabled": true },
  "rotate":    { "enabled": false, "rpm": 33.3 },
  "vhs":       { "enabled": false, "amount": 0.5 },
  "glitch":    { "enabled": false, "amount": 0.5 },
  "background": { "mode": "color", "color": [25, 25, 29], "image_path": null }
}
```

On the web, `media_path` and `image_path` hold a **FileRef** (object) instead of a string. A string value means a desktop import, shown as "Re-select".

Restoring (`apply_state`) is **lenient**:
- Unknown keys in `order` are dropped.
- Missing keys are appended in default order.
- Missing fields take their defaults.
- Opacity/amount → slider via `round(x*100)`.
- Malformed JSON → ignore and keep the defaults.

## History records

Schemas: [04](04-video-creator.md#history-record) (promo), [05](05-media-cutter.md#history-record) (clips), [06](06-media-converter.md#history-record) (converter). Paths become FileRefs; `outputs` become `OutputRef`:

```ts
type OutputRef = { name: string; sink: "directory" | "download" | "zip"; fileRefId?: string; opfsPath?: string };
```

## Import/export (nice-to-have, Phase 4)

- "Export settings & history" → a JSON file.
- "Import from desktop" accepts the same shape. The desktop can produce it with a small script that dumps its `QSettings`.
