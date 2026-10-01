# Changelog

All notable changes to MM Toolkit Web are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow the
policy in `CLAUDE.md` (patch by default, minor/major only when requested).

## [Unreleased]

### Added
- Project scaffold: Vite + Svelte 5 + TypeScript, Vitest, Playwright
  (Chromium/WebKit/Firefox), ESLint, svelte-check, commitlint + husky.
- App shell with hash-routed tabs (Video Creator, Media Cutter, Media
  Converter, History, Settings, About), theme tokens following the OS
  light/dark setting, and an About page with version, dev-build label and a
  per-browser capability summary.
- First engine ports, verified against the desktop golden fixtures:
  timestamp parsing/formatting (incl. Python banker's rounding), safe file
  names and conflict policies, media-kind/extension tables, semver helpers.
- CI (secret scan, lint, typecheck, unit, build, E2E matrix) and a release
  workflow that deploys to GitHub Pages and tags `v<version>`.
- MIT licence.
- Stem Splitter tool added to the roadmap backlog.
- Port specifications (`docs/specs/00`–`14`) covering every desktop tool, the
  audio-analysis and effects algorithms, persistence, file I/O, testing,
  hosting and roadmap.
- Browser feasibility research (`docs/research/browser-feasibility.md`).
- Golden parity fixtures generated from desktop MM Toolkit v1.0.2
  (`fixtures/golden/`) and the generator script.
- Read-only desktop engine/test snapshot (`docs/reference/`) and app assets.
