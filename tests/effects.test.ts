import { readFileSync } from "node:fs";
import { decode } from "fast-png";
import { describe, expect, it } from "vitest";
import {
  applyEffectChain,
  applyGlitch,
  applyOverlay,
  applyRadialBlur,
  applyRotate,
  applyVhs,
  buildBackgroundFrame,
  fitOverlayFrame,
  fitVisualFrame,
} from "../src/engine/effects/cpu/effects";
import type { Image8 } from "../src/engine/effects/cpu/image";
import { solidImage } from "../src/engine/effects/cpu/image";
import { defaultEffectSettings, fromEffectsState, rotateAngle, toEffectsState } from "../src/engine/effects/settings";
import { golden, goldenFile } from "./golden";

function load(relative: string): Image8 {
  const png = decode(readFileSync(goldenFile(relative)));
  if (png.depth !== 8 || (png.channels !== 3 && png.channels !== 4)) throw new Error(`Unexpected PNG format in ${relative}`);
  return { width: png.width, height: png.height, channels: png.channels, data: Uint8Array.from(png.data as Uint8Array) };
}

function diff(a: Image8, b: Image8) {
  expect([a.width, a.height, a.channels]).toEqual([b.width, b.height, b.channels]);
  let max = 0;
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) {
    const d = Math.abs(a.data[i]! - b.data[i]!);
    max = Math.max(max, d);
    sum += d;
  }
  return { max, mean: sum / a.data.length };
}

const cases = Object.fromEntries(golden.effects.cases.map((c) => [c.name, c]));
const input = load("frames/input.png");
const background = load("frames/background.png");
const overlay = load("frames/overlay-rgba.png");

function run(name: string): Image8 {
  const c = cases[name]!;
  const p = c.params as Record<string, number>;
  switch (c.fn) {
    case "apply_radial_blur":
      return applyRadialBlur(input, p.strength!);
    case "apply_rotate":
      return applyRotate(input, p.angleDegrees!, background);
    case "apply_overlay":
      return applyOverlay(input, overlay, p.opacity!);
    case "apply_vhs":
      return applyVhs(input, p.amount!, p.time!);
    case "apply_glitch":
      return applyGlitch(input, p.amount!, p.time!);
    case "fit_overlay_frame": {
      const crop: Image8 = { width: 32, height: 24, channels: 4, data: new Uint8Array(32 * 24 * 4) };
      for (let y = 0; y < 24; y++) crop.data.set(overlay.data.subarray(((y + 12) * 64 + 16) * 4, ((y + 12) * 64 + 48) * 4), y * 32 * 4);
      return fitOverlayFrame(crop, 64, 48);
    }
    case "apply_effect_chain": {
      const settings = defaultEffectSettings();
      settings.overlay = { enabled: true, opacity: 0.75, mediaPath: null };
      settings.rotate = { enabled: true, rpm: 33.3 };
      return applyEffectChain(input, 1.5, settings, background, 0.8, overlay);
    }
    default:
      throw new Error(`No runner for ${c.fn}`);
  }
}

describe("CPU effects vs desktop golden frames", () => {
  const runnable = golden.effects.cases.filter((c) => c.fn);
  it.each(runnable.map((c) => [c.name, c.parity] as const))("%s (%s)", (name, parity) => {
    const actual = run(name);
    const expected = load(cases[name]!.file);
    const { max, mean } = diff(actual, expected);
    if (parity === "exact") expect(max).toBe(0);
    else if (parity === "tolerance") {
      expect(max, `max abs diff ${max}`).toBeLessThanOrEqual(3);
      expect(mean, `mean abs diff ${mean}`).toBeLessThanOrEqual(1);
    } else expect(diff(actual, input).max).toBeGreaterThan(0);
  });

  it("background frame is the solid desktop colour", () => {
    expect(diff(buildBackgroundFrame(64, 48, [25, 25, 29]), background).max).toBe(0);
  });
});

describe("invariants (desktop test_effects.py)", () => {
  it("default chain is a no-op", () => {
    expect(applyEffectChain(input, 0, defaultEffectSettings(), background)).toBe(input);
  });
  it("rotate at 45° reveals the background in the corner", () => {
    const bg = solidImage(40, 40, [5, 5, 5]);
    const square = solidImage(40, 40, [200, 120, 40]);
    expect([...applyRotate(square, 45, bg).data.subarray(0, 3)]).toEqual([5, 5, 5]);
  });
  it("overlay blends by alpha × opacity", () => {
    const black = solidImage(10, 10, [0, 0, 0]);
    const red: Image8 = { width: 10, height: 10, channels: 4, data: new Uint8Array(400) };
    for (let i = 0; i < 100; i++) red.data.set([200, 0, 0, 255], i * 4);
    expect(applyOverlay(black, red, 0.5).data[0]).toBe(100);
  });
  it("VHS and Glitch are deterministic per time", () => {
    expect(applyVhs(input, 0.7, 2.5).data).toEqual(applyVhs(input, 0.7, 2.5).data);
    expect(applyGlitch(input, 0.7, 2.5).data).toEqual(applyGlitch(input, 0.7, 2.5).data);
  });
  it("rotation spins clockwise at rpm/120 revolutions per second", () => {
    expect(rotateAngle(1, 60)).toBe(-180);
  });
});

describe("visual placement (desktop _load_artwork)", () => {
  it("native size crops odd dimensions to even", () => {
    const visual = solidImage(801, 1201, [255, 0, 255]);
    const fitted = fitVisualFrame(visual, null, null);
    expect([fitted.width, fitted.height]).toEqual(golden.pure.artworkCanvas.nativeOdd801x1201.slice(0, 2).reverse());
  });
  it("profile letterboxes without distortion", () => {
    const wide = solidImage(400, 200, [255, 0, 255]);
    const fitted = fitVisualFrame(wide, [108, 192], solidImage(108, 192, [25, 25, 29]));
    expect([fitted.height, fitted.width, 3]).toEqual(golden.pure.artworkCanvas.wide400x200IntoVertical108x192);
    expect([...fitted.data.subarray(0, 3)]).toEqual([25, 25, 29]);
  });
});

describe("effects state JSON (desktop EffectsPanel)", () => {
  it("round-trips", () => {
    const settings = defaultEffectSettings();
    settings.vhs = { enabled: true, amount: 0.37 };
    settings.order = ["vhs", "overlay", "bass_blur", "rotate", "glitch"];
    expect(fromEffectsState(JSON.parse(JSON.stringify(toEffectsState(settings))))).toEqual(settings);
  });
  it("restores leniently", () => {
    const restored = fromEffectsState({ order: ["glitch", "bogus"], vhs: { amount: 0.555 }, background: { color: [1, 2] } });
    expect(restored.order).toEqual(["glitch", "overlay", "bass_blur", "rotate", "vhs"]);
    expect(restored.vhs).toEqual({ enabled: false, amount: 0.56 });
    expect(restored.bass_blur.enabled).toBe(true);
    expect(restored.background.color).toEqual([25, 25, 29]);
    expect(fromEffectsState("not json")).toEqual(defaultEffectSettings());
  });
});
