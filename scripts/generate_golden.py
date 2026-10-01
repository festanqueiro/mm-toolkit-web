"""Generate golden fixtures from the desktop MM Toolkit engine.

The web port must reproduce the desktop app's analysis maths and (within a
small tolerance) its deterministic effects. This script runs the *real*
Python implementation and writes its inputs/outputs to `fixtures/golden/` so
the TypeScript test suite can assert parity without needing Python.

Usage (from this repo's root, with the desktop repo checked out and its venv
active):

    MM_TOOLKIT_DESKTOP=../record-label-mediatools \
        ../record-label-mediatools/.venv/bin/python scripts/generate_golden.py

Re-run whenever the desktop engine's behavior intentionally changes, and
commit the regenerated fixtures together with the matching TS change.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

DESKTOP = Path(os.environ.get("MM_TOOLKIT_DESKTOP", "../record-label-mediatools")).resolve()
sys.path.insert(0, os.fspath(DESKTOP))

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
from PIL import Image  # noqa: E402

from mm_toolkit import __version__  # noqa: E402
from mm_toolkit import core, effects  # noqa: E402
from mm_toolkit.versioning import is_newer_version, version_tuple  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "fixtures" / "golden"
AUDIO_RATE = 11025  # low rate keeps fixtures small; maths are rate-independent


def _desktop_commit() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=DESKTOP, capture_output=True, text=True, check=True
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def _synth_track(path: Path, seconds: float, drop_at: float, bass_hz: float, channels: int, seed: int) -> None:
    """Quiet hats/pad before `drop_at`, then a loud pulsing bass line."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(seconds * AUDIO_RATE)) / AUDIO_RATE
    hats = rng.normal(0, 0.05, t.shape) * (np.sin(2 * np.pi * 4 * t) > 0.6)
    pad = 0.05 * np.sin(2 * np.pi * 440 * t)
    pulse = 0.5 * (1 + np.sign(np.sin(2 * np.pi * 2 * t)))  # 2 Hz on/off kick pattern
    bass = 0.6 * np.sin(2 * np.pi * bass_hz * t) * pulse * (t >= drop_at)
    mono = np.clip(hats + pad + bass, -1, 1)
    data = np.stack([mono, mono * 0.9], axis=1) if channels == 2 else mono
    sf.write(path, data, AUDIO_RATE, subtype="PCM_16")


def audio_fixtures() -> dict:
    audio_dir = OUT / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    cases = [
        ("drop-45s-mono.wav", 60.0, 45.0, 55.0, 1, 1),
        ("drop-30s-stereo.wav", 50.0, 30.0, 80.0, 2, 2),
        ("short-10s-mono.wav", 10.0, 4.0, 60.0, 1, 3),  # shorter than the 20 s skip
    ]
    results = []
    for name, seconds, drop_at, bass_hz, channels, seed in cases:
        path = audio_dir / name
        _synth_track(path, seconds, drop_at, bass_hz, channels, seed)
        envelope = core._build_bass_envelope(path, 24, seconds)
        results.append({
            "file": f"audio/{name}",
            "sampleRate": AUDIO_RATE,
            "channels": channels,
            "seconds": seconds,
            "synthesizedDropAt": drop_at,
            "detectDropTime": core.detect_drop_time(path),
            "detectDropStartWithLeadIn2s": max(0.0, core.detect_drop_time(path) - 2.0),
            "bassEnvelope": {"fps": 24, "duration": seconds, "values": [round(float(v), 6) for v in envelope]},
        })
    return {"tracks": results}


def _base_frame(width: int = 64, height: int = 48) -> np.ndarray:
    """Deterministic gradient + quadrant pattern with enough detail to expose resampling differences."""
    y, x = np.mgrid[0:height, 0:width]
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    frame[..., 0] = (x * 255 // (width - 1)).astype(np.uint8)
    frame[..., 1] = (y * 255 // (height - 1)).astype(np.uint8)
    frame[..., 2] = 128
    frame[height // 2 :, width // 2 :] = (10, 220, 90)
    frame[::8, :] = (255, 255, 255)
    return frame


def _save(array: np.ndarray, name: str) -> str:
    frames = OUT / "frames"
    frames.mkdir(parents=True, exist_ok=True)
    Image.fromarray(array).save(frames / name)
    return f"frames/{name}"


def effect_fixtures() -> dict:
    frame = _base_frame()
    background = effects.build_background_frame((64, 48), effects.BackgroundSettings(color=(25, 25, 29)))
    overlay_rgba = np.zeros((48, 64, 4), dtype=np.uint8)
    overlay_rgba[12:36, 16:48] = (255, 40, 200, 255)
    overlay_rgba[20:28, 24:40, 3] = 128
    cases = [
        {"name": "input", "file": _save(frame, "input.png")},
        {"name": "background", "file": _save(background, "background.png"), "params": {"color": [25, 25, 29]}},
        {"name": "overlay-rgba", "file": _save(overlay_rgba, "overlay-rgba.png")},
    ]

    def case(name: str, fn: str, params: dict, result: np.ndarray, parity: str) -> None:
        cases.append({"name": name, "fn": fn, "params": params, "file": _save(result, f"{name}.png"), "parity": parity})

    for strength in (0.04, 0.5, 1.0):
        case(f"radial-blur-{strength}", "apply_radial_blur", {"strength": strength},
             effects.apply_radial_blur(frame, strength), "tolerance")
    for angle in (0.0, -30.0, 45.0):
        case(f"rotate-{angle}", "apply_rotate", {"angleDegrees": angle, "background": "background"},
             effects.apply_rotate(frame, angle, background), "tolerance")
    for opacity in (0.0, 0.5, 1.0):
        case(f"overlay-{opacity}", "apply_overlay", {"opacity": opacity, "overlay": "overlay-rgba"},
             effects.apply_overlay(frame, overlay_rgba, opacity), "tolerance")
    for amount in (0.0, 0.5, 1.0):
        case(f"vhs-{amount}", "apply_vhs", {"amount": amount, "time": 1.0},
             effects.apply_vhs(frame, amount, 1.0), "exact" if amount == 0 else "visual-only")
        case(f"glitch-{amount}", "apply_glitch", {"amount": amount, "time": 1.0},
             effects.apply_glitch(frame, amount, 1.0), "exact" if amount == 0 else "visual-only")

    chain = effects.EffectSettings(
        overlay=effects.OverlaySettings(enabled=True, opacity=0.75),
        rotate=effects.RotateSettings(enabled=True, rpm=33.3),
    )
    case("chain-overlay-blur-rotate-t1.5", "apply_effect_chain",
         {"time": 1.5, "order": list(chain.order), "overlay": {"enabled": True, "opacity": 0.75},
          "bassBlur": {"enabled": True}, "bassStrength": 0.8, "rotate": {"enabled": True, "rpm": 33.3}},
         effects.apply_effect_chain(frame, 1.5, chain, background, 0.8, overlay_rgba), "tolerance")

    fitted = effects.fit_overlay_frame(overlay_rgba[12:36, 16:48], (64, 48))
    case("fit-overlay-32x24-into-64x48", "fit_overlay_frame", {"size": [64, 48]}, fitted, "tolerance")
    return {
        "notes": (
            "parity=exact: TS output must equal the PNG byte-for-byte in RGB. "
            "parity=tolerance: max per-channel abs diff <= 3 and mean abs diff <= 1 (resampling differs). "
            "parity=visual-only: depends on numpy's PCG64 RNG stream; TS uses its own PRNG, so only "
            "assert shape and that the frame changed."
        ),
        "cases": cases,
    }


def pure_function_fixtures(tmp: Path) -> dict:
    parse_ok = ["195", "03:15", "00:03:15", "1:02:03.5", "0", "59.9", "10:00:00", " 01:00 "]
    parse_bad = ["", "abc", "-1", "1:60", "00:01:60", "1:2:3:4", "1::2", "1.2.3", "60:00"]
    parse_cases = []
    for text in parse_ok + parse_bad:
        try:
            parse_cases.append({"input": text, "seconds": core.parse_timestamp(text)})
        except ValueError as exc:
            parse_cases.append({"input": text, "error": str(exc)})

    names = ['Artist: Track?/Name', "  .hidden. ", "", "a<b>c|d*e", "tab\there", "Ünïcødé – ok", "..."]

    existing = tmp / "video.mp4"
    existing.touch()
    (tmp / "video (2).mp4").touch()
    conflicts = {
        policy: (lambda r: r.name if r else None)(core.resolve_output(existing, policy))
        for policy in ("skip", "overwrite", "rename")
    }

    versions = [("1.0.0", "v1.0.1"), ("1.0.0", "v1.0.0"), ("1.0.0", "release-12"),
                ("1.2.3", "1.10.0"), ("2.0.0", "v1.9.9"), ("1.0.0", "v1.0")]
    return {
        "parseTimestamp": parse_cases,
        "formatTimestamp": [
            {"seconds": s, "text": core.format_timestamp(s)} for s in (0, 0.4, 0.5, 1.5, 59.6, 195, 3599.5, 3723.5, -5)
        ],
        "safeFilename": [{"input": n, "output": core.safe_filename(n)} for n in names],
        "resolveOutput": {
            "existingFiles": ["video.mp4", "video (2).mp4"],
            "requested": "video.mp4",
            "results": conflicts,
        },
        "mediaKind": {
            name: core.media_kind(name)
            for name in ("track.aiff", "track.AIF", "track.mp3", "a.wave", "rec.mkv", "rec.M4V", "notes.txt", "noext")
        },
        "audioExtensions": sorted(core.AUDIO_EXTENSIONS),
        "imageExtensions": sorted(core.IMAGE_EXTENSIONS),
        "videoExtensions": sorted(core.VIDEO_EXTENSIONS),
        "audioOutputFormats": list(core.AUDIO_OUTPUT_FORMATS),
        "videoOutputFormats": list(core.VIDEO_OUTPUT_FORMATS),
        "versionTuple": {v: version_tuple(v) for v in ("v1.2.3", "1.2.3", "1.2", "release-12", " v0.0.1 ")},
        "isNewerVersion": [{"current": c, "candidate": n, "newer": is_newer_version(c, n)} for c, n in versions],
        "artworkCanvas": {
            "nativeOdd801x1201": list(core._load_artwork(_img(tmp, "odd.png", (801, 1201)), None).shape),
            "wide400x200IntoVertical108x192": list(
                core._load_artwork(_img(tmp, "wide.png", (400, 200)), None, (108, 192)).shape
            ),
        },
    }


def _img(tmp: Path, name: str, size: tuple[int, int]) -> Path:
    path = tmp / name
    Image.new("RGB", size, "magenta").save(path)
    return path


def main() -> None:
    import tempfile

    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as scratch:
        manifest = {
            "generatedFrom": {"desktopVersion": __version__, "desktopCommit": _desktop_commit()},
            "audio": audio_fixtures(),
            "effects": effect_fixtures(),
            "pure": pure_function_fixtures(Path(scratch)),
        }
    (OUT / "golden.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote fixtures to {OUT}")


if __name__ == "__main__":
    main()
