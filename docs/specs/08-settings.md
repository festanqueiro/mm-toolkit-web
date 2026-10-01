# 08 — Settings

Port of `ui/settings_tab.py`. Desktop subtitle: *"Defaults shared by all Media Tools features."* One group, **General**. Every change saves immediately (text fields save on blur/Enter).

| Label | Control | Default | Key | Web notes |
|---|---|---|---|---|
| Default Folder for Export | folder picker | none | `general/default_output` | **Tier 1 only** (directory handle). Tier 2 shows: *"Your browser saves exports to its Downloads folder. Batches can be downloaded as a ZIP."* |
| — status | | | | `✓ Default export folder is writable.` / `Optional: choose a writable folder to prefill exports.` |
| Notifications | checkbox "Send a notification when processing finishes" | on | `general/notify_finished` | Turning it on requests Notification permission. If denied, show an inline hint and leave it effectively off |
| Generated video filename | text | `{track} - Promo Snippet` | `general/promo_naming` | empty → reset to default |
| Clip filename | text | `{source} - {title}` | `general/clip_naming` | empty → reset to default |
| Existing files | select: Create a numbered copy / Overwrite / Skip | `rename` | `general/conflict_policy` | Tier 1 only. Hidden on Tier 2, where the browser names downloads |

Changing settings applies immediately to the other tabs. Desktop `apply_app_settings` prefills empty export folders with the default.

## Web-only settings

| Label | Default | Purpose |
|---|---|---|
| Batch download as ZIP | on (Tier 2) | Multiple outputs → a single streamed ZIP instead of many downloads |
| Keep copies of outputs for History | off | See [07](07-history.md#output-retention-web-specific) |
| Allow large WASM conversions | off | Raises the WASM input ceiling from 1.5 GB to ~2 GB at the user's own risk |
| Theme | System | System / Light / Dark |

Validate the naming templates live. Show the same errors the engine would raise, e.g. `Invalid promo naming template. Use {track} and optionally {number}.`
