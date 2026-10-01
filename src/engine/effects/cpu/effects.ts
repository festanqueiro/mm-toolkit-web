/**
 * CPU reference implementations of the desktop effects (`effects.py`, spec 03).
 * They are the parity oracle for the WebGL versions and a fallback for small frames.
 * Frames are RGB (channel 0 = R). Float math mirrors numpy's float32 where it matters.
 */

import { pyRound } from "../../py";
import { rotateAngle, type EffectSettings, type Rgb } from "../settings";
import { addWeighted, cloneImage, createImage, rollRows, solidImage, truncU8, type Image8 } from "./image";
import { cvResizeLinear, cvWarpAffine, paste, pillowContain, pillowFit, rotationMatrix } from "./resample";
import { SeededRandom } from "./rng";

export const BLUR_SAMPLES = 6;
export const MAX_ZOOM = 0.1;
export const STRENGTH_FLOOR = 0.05;

const f32 = Math.fround;

/** `build_background_frame`: cover-fit image (if given) or a solid colour, at canvas size. */
export function buildBackgroundFrame(width: number, height: number, color: Rgb, image?: Image8 | null): Image8 {
  if (image) return pillowFit(image.channels === 3 ? image : dropAlpha(image), width, height);
  return solidImage(width, height, color);
}

/** `fit_overlay_frame`: contain-fit an RGBA image centred on a transparent canvas. */
export function fitOverlayFrame(rgba: Image8, width: number, height: number): Image8 {
  const fitted = pillowContain(rgba, width, height);
  return paste(createImage(width, height, 4), fitted, Math.floor((width - fitted.width) / 2), Math.floor((height - fitted.height) / 2));
}

/** `apply_overlay`: alpha × opacity blend, truncated. */
export function applyOverlay(frame: Image8, overlay: Image8, opacity: number): Image8 {
  if (opacity <= 0) return frame;
  const out = createImage(frame.width, frame.height, 3);
  for (let p = 0; p < frame.width * frame.height; p++) {
    const alpha = f32(f32(overlay.data[p * 4 + 3]! / 255) * opacity);
    const inv = f32(1 - alpha);
    for (let c = 0; c < 3; c++) {
      out.data[p * 3 + c] = truncU8(f32(f32(overlay.data[p * 4 + c]! * alpha) + f32(frame.data[p * 3 + c]! * inv)));
    }
  }
  return out;
}

/** `apply_radial_blur`: average of 6 progressively zoomed, centre-cropped copies. */
export function applyRadialBlur(frame: Image8, strength: number): Image8 {
  if (strength <= STRENGTH_FLOOR) return frame;
  const { width, height } = frame;
  const acc = new Float32Array(width * height * 3);
  for (let i = 1; i <= BLUR_SAMPLES; i++) {
    const zoom = 1 + (MAX_ZOOM * strength * i) / BLUR_SAMPLES;
    const resized = cvResizeLinear(frame, pyRound(width * zoom), pyRound(height * zoom));
    const y0 = Math.floor((resized.height - height) / 2);
    const x0 = Math.floor((resized.width - width) / 2);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const src = ((y + y0) * resized.width + x + x0) * 3;
        const dst = (y * width + x) * 3;
        for (let c = 0; c < 3; c++) acc[dst + c] = acc[dst + c]! + resized.data[src + c]!;
      }
    }
  }
  const out = createImage(width, height, 3);
  for (let i = 0; i < acc.length; i++) out.data[i] = truncU8(f32(acc[i]! / BLUR_SAMPLES));
  return out;
}

/** `apply_rotate`: rotate about the centre (border replicate) and reveal `background` via a coverage mask. */
export function applyRotate(frame: Image8, angleDegrees: number, background: Image8): Image8 {
  const { width, height } = frame;
  const matrix = rotationMatrix(width / 2, height / 2, angleDegrees);
  const rotated = cvWarpAffine(frame, matrix, "replicate");
  const full = createImage(width, height, 3);
  full.data.fill(255);
  const coverage = cvWarpAffine(full, matrix, "constant", 0);
  const out = createImage(width, height, 3);
  for (let p = 0; p < width * height; p++) {
    const alpha = f32(coverage.data[p * 3]! / 255);
    const inv = f32(1 - alpha);
    for (let c = 0; c < 3; c++) {
      out.data[p * 3 + c] = truncU8(f32(f32(rotated.data[p * 3 + c]! * alpha) + f32(background.data[p * 3 + c]! * inv)));
    }
  }
  return out;
}

/** `apply_vhs`: R shifted left, B shifted right, even-row scanlines, seeded grain, dry/wet blend. */
export function applyVhs(frame: Image8, amount: number, time: number): Image8 {
  if (amount <= 0) return frame;
  const { width, height } = frame;
  const shift = Math.max(1, pyRound(6 * amount));
  const shifted = cloneImage(frame);
  rollRows(shifted, 0, height, -shift, 0);
  rollRows(shifted, 0, height, shift, 2);
  const scan = f32(1 - 0.35 * amount);
  const rng = new SeededRandom(Math.trunc(time * 1000));
  const sd = 10 * amount;
  const wet = createImage(width, height, 3);
  for (let y = 0; y < height; y++) {
    const factor = y % 2 === 0 ? scan : 1;
    for (let i = y * width * 3; i < (y + 1) * width * 3; i++) {
      wet.data[i] = truncU8(f32(f32(shifted.data[i]! * factor) + f32(rng.normal(0, sd))));
    }
  }
  return addWeighted(frame, 1 - amount, wet, amount);
}

/** `apply_glitch`: random horizontal slice shifts, blue-channel split above 0.3, dry/wet blend. */
export function applyGlitch(frame: Image8, amount: number, time: number): Image8 {
  if (amount <= 0) return frame;
  const { width, height } = frame;
  const rng = new SeededRandom(Math.trunc(time * 1000) + 1);
  const wet = cloneImage(frame);
  const iterations = Math.trunc(2 + 10 * amount);
  for (let i = 0; i < iterations; i++) {
    if (rng.random() > amount + 0.2) continue;
    const y0 = rng.integers(0, height);
    const y1 = Math.min(height, y0 + rng.integers(2, Math.max(3, Math.trunc(height * 0.05) + 1)));
    const shift = rng.integers(Math.floor(-width / 8), Math.floor(width / 8) + 1);
    rollRows(wet, y0, y1, shift);
  }
  if (amount > 0.3) rollRows(wet, 0, height, pyRound(4 * amount), 2);
  return addWeighted(frame, 1 - amount, wet, amount);
}

/** `apply_effect_chain`: apply enabled effects in `settings.order`. */
export function applyEffectChain(
  frame: Image8,
  time: number,
  settings: EffectSettings,
  background: Image8,
  bassStrength?: number | null,
  overlayFrame?: Image8 | null,
): Image8 {
  let result = frame;
  for (const key of settings.order) {
    if (key === "overlay") {
      if (settings.overlay.enabled && overlayFrame) result = applyOverlay(result, overlayFrame, settings.overlay.opacity);
    } else if (key === "bass_blur") {
      if (settings.bass_blur.enabled && bassStrength != null) result = applyRadialBlur(result, bassStrength);
    } else if (key === "rotate") {
      if (settings.rotate.enabled) result = applyRotate(result, rotateAngle(time, settings.rotate.rpm), background);
    } else if (key === "vhs") {
      if (settings.vhs.enabled) result = applyVhs(result, settings.vhs.amount, time);
    } else if (key === "glitch") {
      if (settings.glitch.enabled) result = applyGlitch(result, settings.glitch.amount, time);
    }
  }
  return result;
}

/**
 * `_load_artwork` / `_fit_visual_frame`: place a visual on the output canvas. With an output
 * size it's contain-fit (Lanczos) and centred on `background`; without, it's cropped to even
 * dimensions (H.264 4:2:0) — at most one edge pixel removed.
 */
export function fitVisualFrame(visual: Image8, outputSize: [number, number] | null, background: Image8 | null): Image8 {
  const rgb = visual.channels === 3 ? visual : dropAlpha(visual);
  if (outputSize) {
    const [width, height] = outputSize;
    const fitted = pillowContain(rgb, width, height);
    const canvas = background ?? solidImage(width, height, [25, 25, 29]);
    return paste(canvas, fitted, Math.floor((width - fitted.width) / 2), Math.floor((height - fitted.height) / 2));
  }
  const width = rgb.width - (rgb.width % 2);
  const height = rgb.height - (rgb.height % 2);
  if (width === rgb.width && height === rgb.height) return rgb;
  const out = createImage(width, height, 3);
  for (let y = 0; y < height; y++) out.data.set(rgb.data.subarray(y * rgb.width * 3, y * rgb.width * 3 + width * 3), y * width * 3);
  return out;
}

/** Pillow `convert("RGB")` from RGBA: drop alpha (no compositing). */
export function dropAlpha(image: Image8): Image8 {
  const out = createImage(image.width, image.height, 3);
  for (let p = 0; p < image.width * image.height; p++) out.data.set(image.data.subarray(p * 4, p * 4 + 3), p * 3);
  return out;
}
