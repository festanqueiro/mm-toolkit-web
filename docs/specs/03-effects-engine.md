# 03 — Effects Engine

Port of `mm_toolkit/effects.py`. All effects are **pure per-frame functions over full RGB frames** at the output canvas size. The primary implementation is **WebGL2 shaders** (`engine/effects/gl/`), backed by a **CPU reference** (`engine/effects/cpu/`) that is tested against the golden PNGs. GL output is then tested against the CPU reference.

> ⚠️ **Channel-naming gotcha in the desktop source.** Frames are **RGB** numpy arrays, but `apply_vhs`/`apply_glitch` call `cv2.split` and name the results `b, g, r`. So "`b`" is really **R** (channel 0) and "`r`" is really **B** (channel 2). The *behaviour* below is described in true RGB terms. The Glitch "red split" actually shifts the **blue** channel. Replicate the behaviour, not the variable names.

## Settings model (TS port of the dataclasses)

```ts
type BackgroundSettings = { mode: "color" | "image"; color: [r, g, b] /* default [25,25,29] */; imagePath: string | null };
type OverlaySettings    = { enabled: boolean /* false */; mediaPath: string | null; opacity: number /* 0..1, default 1.0 */ };
type BassBlurSettings   = { enabled: boolean /* TRUE by default */ };
type RotateSettings     = { enabled: boolean /* false */; rpm: number /* 33.3, UI range 0.1–200.0, 1 decimal */ };
type VhsSettings        = { enabled: boolean /* false */; amount: number /* 0..1, default 0.5 */ };
type GlitchSettings     = { enabled: boolean /* false */; amount: number /* 0..1, default 0.5 */ };
type EffectKey = "overlay" | "bass_blur" | "rotate" | "vhs" | "glitch";
const DEFAULT_EFFECT_ORDER: EffectKey[] = ["overlay", "bass_blur", "rotate", "vhs", "glitch"];
type EffectSettings = { background; order: EffectKey[]; overlay; bass_blur; rotate; vhs; glitch };
```

In the web app, `imagePath`/`mediaPath` become **file references** (see [11](11-data-model-and-persistence.md)). Keep the persisted JSON keys identical to desktop (`media_path`, `image_path`) so desktop history/effect JSON can be imported.

## `applyEffectChain(frame, t, settings, background, bassStrength?, overlayFrame?)`

Iterate `settings.order`. For each key, apply the effect only if it's enabled (and its input exists):

| Key | Condition | Call |
|---|---|---|
| `overlay` | `overlay.enabled && overlayFrame` | `applyOverlay(result, overlayFrame, overlay.opacity)` |
| `bass_blur` | `bass_blur.enabled && bassStrength != null` | `applyRadialBlur(result, bassStrength)` |
| `rotate` | `rotate.enabled` | `applyRotate(result, angle, background)`, where `angle = -(t * rpm / 120) * 360` degrees (see note) |
| `vhs` | `vhs.enabled` | `applyVhs(result, vhs.amount, t)` |
| `glitch` | `glitch.enabled` | `applyGlitch(result, glitch.amount, t)` |

Rotate note: the desktop **divides by 120, not 60**, on purpose. The literal RPM read as twice too fast on screen. The angle is **negated**, because OpenCV's positive angle is counter-clockwise and a record spins **clockwise**. Keep both.

The default settings (only Bass Blur enabled, but no `bassStrength`) are a **no-op**.

## Background — `buildBackgroundFrame([w, h], settings)`

- `mode === "image"` and the image is readable → **cover-fit** (`ImageOps.fit`, Lanczos, centred crop) to `w×h`.
- Otherwise (including a missing or unreadable image) → solid `color`.
- Rendered **once per job**, then reused for letterboxing and for Rotate's revealed corners.

## Overlay

- `loadOverlayImage(file, [w, h])` → RGBA. **Contain-fit** (Lanczos), centred on a **transparent** `w×h` canvas.
- `applyOverlay(frame, rgba, opacity)`:
  - `opacity <= 0` → return the frame unchanged.
  - `alpha = (A / 255) * opacity`; `out = RGB * alpha + frame * (1 − alpha)`; **truncate** to uint8 (`astype`), don't round.
- Still images only. Desktop 1.0.2 dropped video overlays.

## Bass-reactive radial blur — `applyRadialBlur(frame, strength)`

```
BLUR_SAMPLES = 6; MAX_ZOOM = 0.10; STRENGTH_FLOOR = 0.05
if strength <= 0.05: return frame
acc = 0
for i in 1..6:                                  # note: starts at 1, so no un-zoomed copy
    zoom = 1 + 0.10 * strength * i / 6
    resized = resize(frame, (round(w*zoom), round(h*zoom)), bilinear)
    y = floor((resized.h - h) / 2); x = floor((resized.w - w) / 2)
    acc += resized[y:y+h, x:x+w]
return truncate(acc / 6)
```

GL: one pass with 6 texture taps at UV `c + (uv − c) / zoom_i`, sampling bilinearly, then average. Expect tiny sampling differences from OpenCV's `INTER_LINEAR` with its integer-rounded target size. Test with tolerance.

## Rotate — `applyRotate(frame, angleDeg, background)`

- Rotate about `(w/2, h/2)` (`cv2.getRotationMatrix2D`, positive = CCW, scale 1), bilinear, **border = replicate**.
- Coverage mask: rotate an all-255 single-channel image with the same matrix, bilinear, border = constant 0. `alpha = mask / 255`.
- `out = rotated * alpha + background * (1 − alpha)`, truncated.
- Why border-replicate: a black-filled border gives a visible dark seam at the anti-aliased edge (desktop fix in 1.0.2). The GL version must not reintroduce the seam.
- At 0° the output must equal the input exactly (golden `rotate-0.0`).

## VHS — `applyVhs(frame, amount, t)`

```
if amount <= 0: return frame
shift = max(1, pyRound(6 * amount))             # Python round = banker's rounding
wet.R = roll(frame.R, -shift, axis=x)           # R moves LEFT (wraps)
wet.G = frame.G
wet.B = roll(frame.B, +shift, axis=x)           # B moves RIGHT (wraps)
rows 0,2,4,… of wet *= (1 − 0.35 * amount)      # scanlines on even rows
wet += Normal(0, 10 * amount) noise per pixel per channel, seeded by floor(t * 1000)
wet = clip(wet, 0, 255) → truncate to uint8
out = addWeighted(frame, 1 − amount, wet, amount) # saturating, round-to-nearest
```

The noise uses numpy's `default_rng(seed).normal`. The web port uses its own seeded PRNG (e.g. mulberry32 + Box-Muller, or a shader hash of `(x, y, seed)`). Output is **visual parity only**. It must be deterministic per `(t, pixel)`, so re-renders are identical.

Backlog (desktop TODO): a scrolling brightness/tracking band moving bottom → top over time.

## Glitch — `applyGlitch(frame, amount, t)`

```
if amount <= 0: return frame
rng = seeded(floor(t * 1000) + 1)
wet = copy(frame)
repeat floor(2 + 10 * amount) times:
    if rng.random() > amount + 0.2: continue
    y0 = rng.int(0, h)                               # [0, h)
    y1 = min(h, y0 + rng.int(2, max(3, floor(h * 0.05) + 1)))
    s  = rng.int(floor(-w / 8), floor(w / 8) + 1)    # Python `-width // 8` == floor(-w/8), e.g. w=60 → -8 (not -7)
    wet[y0:y1] = roll(wet[y0:y1], s, axis=x)
if amount > 0.3:
    wet.B = roll(wet.B, pyRound(4 * amount), axis=x) # BLUE channel (see gotcha)
out = addWeighted(frame, 1 − amount, wet, amount)
```

GL: compute the slice table on the CPU per frame (cheap) and pass it as a uniform array or small texture. Visual parity only.

## Fades (post-effects)

Applied by the render pipeline after the cascade:

- **Video fade** (default on): linear fade from black over `fade` seconds at the start and to black at the end (moviepy `FadeIn`/`FadeOut`). `fade = min(0.5, actualDuration / 2)`.
- **Audio fade** (default on): linear gain ramps over the same `fade` length, applied to the **music** track only.

## Golden fixtures

`fixtures/golden/frames/*.png` + `golden.json → effects.cases`, each tagged with a parity level:

- `exact`: byte-equal RGB (e.g. VHS/Glitch at amount 0, Rotate 0°, Overlay opacity 0).
- `tolerance`: max abs diff ≤ 3 and mean abs diff ≤ 1 per channel.
- `visual-only`: same shape, differs from input. Optionally a perceptual check.

## Backlog (from desktop TODO, Prio 1)

- **New effects:** Black & White (desaturate) and Negative (invert RGB), as boolean effects.
- **Layers vs. cascade ordering:** a global toggle that applies the cascade before or after the Layers (Background + Overlay) are composited.
- **Background enable/disable:** off means transparent/black letterbox and black rotate corners.
- **Rolling text ticker** overlay (Prio 3).
