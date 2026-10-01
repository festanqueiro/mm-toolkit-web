# Desktop reference snapshot

Read-only copies from [`festanqueiro/mm-toolkit`](https://github.com/festanqueiro/mm-toolkit) at **v1.0.2, commit `a0c8576a7cf3c9e6eb692f5f5e4eaed7d613569c`**. Use them as the oracle for behaviour the specs don't cover. **Don't modify them.** To refresh, re-copy from the desktop repo and update the commit above.

| File | Why it's here |
|---|---|
| `desktop-source/mm_toolkit/core.py` | Engine: timestamps, naming, validation, drop detection, envelope, render pipeline, FFmpeg argument tables for the cutter/converter |
| `desktop-source/mm_toolkit/effects.py` | Effect algorithms and settings dataclasses |
| `desktop-source/mm_toolkit/versioning.py` | Semver helpers |
| `desktop-source/tests/*.py` | Desktop test suite (mapping to web tests: spec 12) |
| `desktop-CHANGELOG.md` | Desktop history, incl. why Rotate is /120 and clockwise, the seam fix, and overlay scoped to images |
| `desktop-TODO.md` | Desktop backlog (folded into spec 14) |

The UI (`mm_toolkit/ui/*.py`, PySide6) isn't copied. Its behaviour, layout and every user-facing string are transcribed into specs 04–09.
