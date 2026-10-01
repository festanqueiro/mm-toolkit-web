# Specifications

Specs for porting MM Toolkit (desktop v1.0.2, commit `a0c8576`) to a fully client-side web app. Read them in order.

| # | Spec | What it pins down |
|---|---|---|
| 00 | [Product overview](00-product-overview.md) | Goals, hard constraints, browser tiers, glossary |
| 01 | [Architecture](01-architecture.md) | Stack, layering, worker protocol, capability detection, codec routing, licensing |
| 02 | [Audio analysis](02-audio-analysis.md) | Drop detection & bass envelope, exact maths |
| 03 | [Effects engine](03-effects-engine.md) | Every effect's algorithm, parity levels, channel-naming gotcha |
| 04 | [Video Creator](04-video-creator.md) | UI, messages, render pipeline, quality mapping, live preview |
| 05 | [Media Cutter](05-media-cutter.md) | UI, clip rules, per-format output settings |
| 06 | [Media Converter](06-media-converter.md) | Batch rules, encoding matrix, size limits |
| 07 | [History](07-history.md) | Records, Load Job, notifications, output retention |
| 08 | [Settings](08-settings.md) | All settings, web-only additions |
| 09 | [App shell & About](09-app-shell-and-about.md) | Tabs, theming, update prompt, PWA |
| 10 | [File I/O, naming & timestamps](10-file-io-and-naming.md) | Parsing/formatting, templates, conflict policy, output sinks |
| 11 | [Data model & persistence](11-data-model-and-persistence.md) | Storage keys, FileRef, effects JSON, history schema |
| 12 | [Testing & parity](12-testing-and-parity.md) | Golden fixtures, ported tests, definition of done |
| 13 | [Hosting, CI & release](13-hosting-ci-release.md) | Static hosting, headers, conventions, workflows |
| 14 | [Roadmap](14-roadmap.md) | Phases, open decisions (ADRs), backlog |

Background research: [`../research/browser-feasibility.md`](../research/browser-feasibility.md).
Desktop source snapshot: [`../reference/`](../reference/).

## Conventions in these specs

- **Exact strings** in tables and backticks are user-facing copy carried over from desktop. Keep them unless a spec marks a deviation.
- "Desktop" means `festanqueiro/mm-toolkit` at commit `a0c8576`. When a spec and the desktop source disagree, the spec wins if it **explicitly** documents a deviation. Otherwise desktop behaviour wins; fix the spec.
- **ADR-NNN** marks an open decision, tracked in [14 — Phase 0](14-roadmap.md).
