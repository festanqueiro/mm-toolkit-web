/**
 * WebGL effect cascade vs the CPU reference and the desktop golden frames (spec 12,
 * layer 2). Runs in real Chromium, WebKit and Firefox through Vitest browser mode.
 */
import { decode } from "fast-png";
import { beforeAll, describe, expect, it } from "vitest";
import goldenJson from "../../fixtures/golden/golden.json";
import { applyEffectChain, applyGlitch, applyVhs, applyVideoFade } from "../../src/engine/effects/cpu/effects";
import type { Image8 } from "../../src/engine/effects/cpu/image";
import { GlEffectRenderer } from "../../src/engine/effects/gl/renderer";
import { defaultEffectSettings, type EffectSettings } from "../../src/engine/effects/settings";

type Case = { name: string; file: string; fn?: string; params?: Record<string, number>; parity?: string };
const cases = (goldenJson as unknown as { effects: { cases: Case[] } }).effects.cases;
const frameUrls = import.meta.glob("../../fixtures/golden/frames/*.png", { query: "?url", import: "default", eager: true }) as Record<string, string>;

async function load(file: string): Promise<Image8> {
  const url = frameUrls[`../../fixtures/golden/${file}`];
  if (!url) throw new Error(`Missing fixture ${file}`);
  const png = decode(new Uint8Array(await (await fetch(url)).arrayBuffer()));
  return { width: png.width, height: png.height, channels: png.channels as 3 | 4, data: Uint8Array.from(png.data as Uint8Array) };
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

/** Spec 03: GPU vs CPU reference, max abs diff ≤ 3 and mean ≤ 1. */
function expectClose(actual: Image8, expected: Image8) {
  const { max, mean } = diff(actual, expected);
  expect(max, `max abs diff (mean ${mean.toFixed(4)})`).toBeLessThanOrEqual(3);
  expect(mean).toBeLessThanOrEqual(1);
}

/** Only `key` enabled, everything else off. */
function only(key: "overlay" | "bass_blur" | "rotate" | "vhs" | "glitch", patch: Partial<EffectSettings> = {}): EffectSettings {
  const s = defaultEffectSettings();
  s.bass_blur.enabled = key === "bass_blur";
  s.overlay.enabled = key === "overlay";
  s.rotate.enabled = key === "rotate";
  s.vhs.enabled = key === "vhs";
  s.glitch.enabled = key === "glitch";
  return { ...s, ...patch };
}

let input: Image8;
let background: Image8;
let overlay: Image8;
let gl: GlEffectRenderer;

beforeAll(async () => {
  [input, background, overlay] = await Promise.all([load("frames/input.png"), load("frames/background.png"), load("frames/overlay-rgba.png")]);
  gl = new GlEffectRenderer(new OffscreenCanvas(1, 1), input.width, input.height);
  gl.setBackground(background);
  gl.setOverlay(overlay);
});

function renderCase(c: Case): Image8 {
  const p = c.params ?? {};
  switch (c.fn) {
    case "apply_radial_blur":
      gl.render(input, { time: 0, settings: only("bass_blur"), bassStrength: p.strength! });
      break;
    case "apply_rotate": {
      // rotateAngle(t, rpm) = -(t * rpm / 120) * 360 → pick t for the golden angle at rpm 120.
      const settings = only("rotate");
      settings.rotate.rpm = 120;
      gl.render(input, { time: -p.angleDegrees! / 360, settings });
      break;
    }
    case "apply_overlay": {
      const settings = only("overlay");
      settings.overlay.opacity = p.opacity!;
      gl.render(input, { time: 0, settings });
      break;
    }
    case "apply_vhs": {
      const settings = only("vhs");
      settings.vhs.amount = p.amount!;
      gl.render(input, { time: p.time!, settings });
      break;
    }
    case "apply_glitch": {
      const settings = only("glitch");
      settings.glitch.amount = p.amount!;
      gl.render(input, { time: p.time!, settings });
      break;
    }
    case "apply_effect_chain": {
      const settings = defaultEffectSettings();
      settings.overlay = { enabled: true, opacity: 0.75, mediaPath: null };
      settings.rotate = { enabled: true, rpm: 33.3 };
      gl.render(input, { time: 1.5, settings, bassStrength: 0.8 });
      break;
    }
    default:
      throw new Error(`No GL runner for ${c.fn}`);
  }
  return gl.readPixels();
}

describe("GL effects vs desktop golden frames", () => {
  const deterministic = cases.filter((c) => c.parity === "exact" && c.fn !== "fit_overlay_frame");
  it.each(deterministic.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    expectClose(renderCase(c), await load(c.file));
  });
});

describe("GL effects vs CPU reference", () => {
  for (const amount of [0.25, 0.5, 1]) {
    for (const time of [0, 1, 2.345]) {
      it(`VHS ${amount} at t=${time}`, () => {
        const settings = only("vhs");
        settings.vhs.amount = amount;
        gl.render(input, { time, settings });
        expectClose(gl.readPixels(), applyVhs(input, amount, time));
      });
      it(`Glitch ${amount} at t=${time}`, () => {
        const settings = only("glitch");
        settings.glitch.amount = amount;
        gl.render(input, { time, settings });
        expectClose(gl.readPixels(), applyGlitch(input, amount, time));
      });
    }
  }

  it("full cascade in a custom order with fade", () => {
    const settings = defaultEffectSettings();
    settings.order = ["glitch", "rotate", "vhs", "bass_blur", "overlay"];
    settings.overlay = { enabled: true, opacity: 0.6, mediaPath: null };
    settings.rotate = { enabled: true, rpm: 45 };
    settings.vhs = { enabled: true, amount: 0.4 };
    settings.glitch = { enabled: true, amount: 0.7 };
    gl.render(input, { time: 3.21, settings, bassStrength: 0.9, fadeGain: 0.37 });
    const cpu = applyVideoFade(applyEffectChain(input, 3.21, settings, background, 0.9, overlay), 0.37);
    expectClose(gl.readPixels(), cpu);
  });

  it("video fade truncates like moviepy", () => {
    for (const gain of [0, 0.123, 0.5, 0.999]) {
      gl.render(input, { time: 0, settings: only("rotate", { rotate: { enabled: false, rpm: 1 } }), fadeGain: gain });
      expectClose(gl.readPixels(), applyVideoFade(input, gain));
    }
  });

  it("default settings without bass strength are a no-op", () => {
    gl.render(input, { time: 1, settings: defaultEffectSettings() });
    expect(diff(gl.readPixels(), input).max).toBe(0);
  });

  it("is deterministic per time", () => {
    const settings = only("vhs");
    gl.render(input, { time: 1.5, settings });
    const first = gl.readPixels();
    gl.render(input, { time: 1.5, settings });
    expect(diff(gl.readPixels(), first).max).toBe(0);
  });
});

describe("GL presentation", () => {
  it("draws the result upright on an HTML canvas", () => {
    const canvas = document.createElement("canvas");
    const renderer = new GlEffectRenderer(canvas, input.width, input.height);
    renderer.render(input, { time: 0, settings: only("rotate", { rotate: { enabled: false, rpm: 1 } }) });
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.canvas.width = input.width;
    ctx.canvas.height = input.height;
    ctx.drawImage(canvas, 0, 0);
    const shown = ctx.getImageData(0, 0, input.width, input.height).data;
    renderer.dispose();
    for (const [x, y] of [
      [0, 0],
      [input.width - 1, 0],
      [5, input.height - 1],
    ] as const) {
      const p = y * input.width + x;
      expect([...shown.subarray(p * 4, p * 4 + 3)]).toEqual([...input.data.subarray(p * 3, p * 3 + 3)]);
    }
  });
});
