# 00 — Product Overview

## Purpose

**MM Toolkit Web** is the browser edition of [MM Toolkit](https://github.com/festanqueiro/mm-toolkit), the desktop app (PySide6 + FFmpeg) used by a record label to prepare music content. The web edition must provide the same three tools, with **all media processing done on the user's device**.

| Tool | One-line description (desktop copy) |
|---|---|
| **Video Creator** | "Turn audio plus an image or video into a new music video at the visual's native resolution." |
| **Media Cutter** | "Cut audio or video into precisely timed clips. Use HH:MM:SS, MM:SS, or seconds. End is optional; duration defaults to 60 seconds." |
| **Media Converter** | "Convert batches of audio or video files into another common format." |

Supporting screens: **History**, **Settings**, **About**. Tagline: **"Audio & Video tools for all"**.

## Hard constraints

1. **No server-side processing. Ever.** Media files never leave the browser. The deployment is static files only: HTML/JS/CSS/WASM, plus fonts and images that we serve ourselves. No upload endpoints, no analytics that receive file names or contents.
2. **No accounts, no backend state.** Persistence is browser storage only (see [11](11-data-model-and-persistence.md)).
3. **Behavioral parity with desktop v1.0.2** (commit `a0c8576`) unless a spec here explicitly documents a deviation. The desktop Python source is snapshotted in [`docs/reference/desktop-source/`](../reference/desktop-source/) and is the oracle for ambiguous cases.
4. **Works offline after first load** (PWA). This is a goal, not a v0.1 blocker.

## Target platforms

| Tier | Browsers | Expectation |
|---|---|---|
| **Tier 1** | Chrome / Edge (desktop, current and previous stable) | Full feature set, incl. writing into a chosen export folder |
| **Tier 2** | Safari (macOS, current), Firefox (desktop, current) | Every tool works; exports go to Downloads, or a ZIP for batches; some codecs use the WASM fallback |
| **Tier 3** | Mobile Safari / Chrome Android | Best effort: small jobs, screen kept awake, no guarantees |

Feature availability is decided by **runtime capability detection**, never by user-agent sniffing (see [01](01-architecture.md#capability-detection)).

## Goals

- Parity of **analysis** (drop detection, bass envelope): numerically equivalent to desktop. Verified by golden fixtures ([12](12-testing-and-parity.md)).
- Parity of **effects**: visually equivalent. Deterministic effects within a small per-pixel tolerance. RNG-driven effects (VHS, Glitch) only need to look the same.
- **Hardware-accelerated** encoding where available (WebCodecs). A 60 s 1080×1920 promo should render in time comparable to desktop on the same machine.
- **New capability: live effect preview** in Video Creator, which the desktop app lacks.

## Non-goals (for now)

- Pixel-identical or bitstream-identical output to desktop.
- x264 CRF / preset semantics (replaced by quality presets; see [04](04-video-creator.md#output-and-encoding)).
- Background or unattended jobs that survive closing the tab.
- Files larger than roughly 2 GB on the WASM fallback path.
- Mobile-first UI. The layout must not break on a phone, but the desktop two-column layout is primary.
- Replacing the desktop app. Both products coexist; the desktop stays the choice for huge files and unattended batches.

## Glossary

| Term | Meaning |
|---|---|
| **Promo / promo snippet** | A short video made by Video Creator from one audio track (default name `{track} - Promo Snippet`). History records use tool key `"promo"`. |
| **Visual** | The image or video that forms the picture of a promo. Desktop UI label: "Image or video". |
| **Drop** | The moment a track's bass energy jumps most (see [02](02-audio-analysis.md)). |
| **Lead-in** | Seconds to start before the detected drop. Default 2.0. Desktop only: the web app has no drop detection UI ([04](04-video-creator.md)). |
| **Cascade** | The ordered list of visual effects applied per frame. |
| **Layers** | Background fill (solid colour or image) and Overlay image. |
| **WebCodecs path / WASM path** | Native browser codecs vs. the ffmpeg.wasm fallback. |
