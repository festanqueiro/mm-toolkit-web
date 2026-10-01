/** Effect settings model — port of the `effects.py` dataclasses and `EffectsPanel` state JSON (specs 03, 11). */

export type EffectKey = "overlay" | "bass_blur" | "rotate" | "vhs" | "glitch";

/** Default cascade order; also the set of valid keys. */
export const DEFAULT_EFFECT_ORDER: readonly EffectKey[] = ["overlay", "bass_blur", "rotate", "vhs", "glitch"];

export type Rgb = [number, number, number];

import { pyRound } from "../py";

/** File reference placeholder until io/FileRef lands; desktop JSON stores plain path strings. */
export type MediaRef = string | { id: string; name: string } | null;

export type BackgroundSettings = { mode: "color" | "image"; color: Rgb; imagePath: MediaRef };
export type OverlaySettings = { enabled: boolean; mediaPath: MediaRef; opacity: number };
export type BassBlurSettings = { enabled: boolean };
export type RotateSettings = { enabled: boolean; rpm: number };
export type VhsSettings = { enabled: boolean; amount: number };
export type GlitchSettings = { enabled: boolean; amount: number };

export type EffectSettings = {
  background: BackgroundSettings;
  order: EffectKey[];
  overlay: OverlaySettings;
  bass_blur: BassBlurSettings;
  rotate: RotateSettings;
  vhs: VhsSettings;
  glitch: GlitchSettings;
};

export const DEFAULT_BACKGROUND_COLOR: Rgb = [25, 25, 29];

export function defaultEffectSettings(): EffectSettings {
  return {
    background: { mode: "color", color: [...DEFAULT_BACKGROUND_COLOR], imagePath: null },
    order: [...DEFAULT_EFFECT_ORDER],
    overlay: { enabled: false, mediaPath: null, opacity: 1 },
    bass_blur: { enabled: true },
    rotate: { enabled: false, rpm: 33.3 },
    vhs: { enabled: false, amount: 0.5 },
    glitch: { enabled: false, amount: 0.5 },
  };
}

/** Desktop `EffectsPanel.state_dict()` JSON shape (keys kept identical for import/export). */
export type EffectsState = {
  order: string[];
  overlay: { enabled: boolean; opacity: number; media_path: MediaRef };
  bass_blur: { enabled: boolean };
  rotate: { enabled: boolean; rpm: number };
  vhs: { enabled: boolean; amount: number };
  glitch: { enabled: boolean; amount: number };
  background: { mode: "color" | "image"; color: Rgb; image_path: MediaRef };
};

export function toEffectsState(settings: EffectSettings): EffectsState {
  return {
    order: [...settings.order],
    overlay: { enabled: settings.overlay.enabled, opacity: settings.overlay.opacity, media_path: settings.overlay.mediaPath },
    bass_blur: { enabled: settings.bass_blur.enabled },
    rotate: { enabled: settings.rotate.enabled, rpm: settings.rotate.rpm },
    vhs: { enabled: settings.vhs.enabled, amount: settings.vhs.amount },
    glitch: { enabled: settings.glitch.enabled, amount: settings.glitch.amount },
    background: { mode: settings.background.mode, color: [...settings.background.color], image_path: settings.background.imagePath },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
/** Sliders store whole percentages: `round(x * 100) / 100`, as the desktop round-trips through QSlider. */
const percent = (value: unknown, fallback: number) => Math.min(100, Math.max(0, pyRound(num(value, fallback) * 100))) / 100;
const ref = (value: unknown): MediaRef =>
  typeof value === "string" ? value || null : isRecord(value) && typeof value.id === "string" ? (value as { id: string; name: string }) : null;

/**
 * Lenient restore, mirroring desktop `EffectsPanel.apply_state`: unknown order keys are
 * dropped, missing keys appended in default order, missing fields take defaults.
 */
export function fromEffectsState(raw: unknown): EffectSettings {
  const settings = defaultEffectSettings();
  if (!isRecord(raw)) return settings;
  const order = Array.isArray(raw.order) ? raw.order.filter((k): k is EffectKey => DEFAULT_EFFECT_ORDER.includes(k as EffectKey)) : [];
  settings.order = [...new Set(order), ...DEFAULT_EFFECT_ORDER.filter((k) => !order.includes(k))];
  const overlay = isRecord(raw.overlay) ? raw.overlay : {};
  settings.overlay = { enabled: overlay.enabled === true, opacity: percent(overlay.opacity, 1), mediaPath: ref(overlay.media_path) };
  const bass = isRecord(raw.bass_blur) ? raw.bass_blur : {};
  settings.bass_blur = { enabled: bass.enabled === undefined ? true : bass.enabled === true };
  const rotate = isRecord(raw.rotate) ? raw.rotate : {};
  settings.rotate = { enabled: rotate.enabled === true, rpm: Math.min(200, Math.max(0.1, Math.round(num(rotate.rpm, 33.3) * 10) / 10)) };
  const vhs = isRecord(raw.vhs) ? raw.vhs : {};
  settings.vhs = { enabled: vhs.enabled === true, amount: percent(vhs.amount, 0.5) };
  const glitch = isRecord(raw.glitch) ? raw.glitch : {};
  settings.glitch = { enabled: glitch.enabled === true, amount: percent(glitch.amount, 0.5) };
  const background = isRecord(raw.background) ? raw.background : {};
  const color = Array.isArray(background.color) && background.color.length === 3 ? background.color.map((c) => Math.trunc(num(c, 0))) : null;
  settings.background = {
    mode: background.mode === "image" ? "image" : "color",
    color: (color as Rgb | null) ?? [...DEFAULT_BACKGROUND_COLOR],
    imagePath: ref(background.image_path),
  };
  return settings;
}

/** Rotation angle in degrees at time `t` (desktop: /120 not /60 on purpose; negated for clockwise). */
export function rotateAngle(t: number, rpm: number): number {
  return -((t * rpm) / 120) * 360;
}
