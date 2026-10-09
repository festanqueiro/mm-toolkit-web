/** Typed app settings with the desktop's exact key names (spec 11). */
import type { ConflictPolicy } from "../engine/naming";
import type { FileRef } from "../io/file-ref";
import { dbEntries, dbSet } from "./db";

export type Theme = "system" | "light" | "dark";

export type Settings = {
  "general/default_output": FileRef | null;
  "general/notify_finished": boolean;
  "general/promo_naming": string;
  "general/clip_naming": string;
  "general/conflict_policy": ConflictPolicy;
  music: FileRef | null;
  cover: FileRef | null;
  output: FileRef | null;
  "promo/video_fade": boolean;
  "promo/audio_fade": boolean;
  "promo/mute_original_video_audio": boolean;
  "promo/effects_state": string | null;
  "clips/source": FileRef | null;
  "clips/output": FileRef | null;
  "web/zip_batches": boolean;
  "web/keep_output_copies": boolean;
  "web/wasm_large_inputs": boolean;
  "web/theme": Theme;
};

export type SettingKey = keyof Settings;

export const DEFAULT_PROMO_NAMING = "{track} - Promo Snippet";
export const DEFAULT_CLIP_NAMING = "{source} - {title}";

export const SETTING_DEFAULTS: Readonly<Settings> = Object.freeze({
  "general/default_output": null,
  "general/notify_finished": true,
  "general/promo_naming": DEFAULT_PROMO_NAMING,
  "general/clip_naming": DEFAULT_CLIP_NAMING,
  "general/conflict_policy": "rename",
  music: null,
  cover: null,
  output: null,
  "promo/video_fade": false,
  "promo/audio_fade": true,
  "promo/mute_original_video_audio": true,
  "promo/effects_state": null,
  "clips/source": null,
  "clips/output": null,
  "web/zip_batches": true,
  "web/keep_output_copies": false,
  "web/wasm_large_inputs": false,
  "web/theme": "system",
});

const isKey = (key: IDBValidKey): key is SettingKey => typeof key === "string" && key in SETTING_DEFAULTS;

/** All settings: stored values over defaults (unknown stored keys are ignored). */
export async function loadSettings(): Promise<Settings> {
  const settings: Settings = { ...SETTING_DEFAULTS };
  for (const [key, value] of await dbEntries<unknown>("settings")) {
    if (isKey(key) && value !== undefined) (settings as Record<SettingKey, unknown>)[key] = value;
  }
  return settings;
}

export function saveSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<IDBValidKey> {
  return dbSet("settings", key, value);
}

/** Desktop behaviour: an emptied naming template falls back to its default. */
export function normaliseNaming(key: "general/promo_naming" | "general/clip_naming", value: string): string {
  return value.trim() || (key === "general/promo_naming" ? DEFAULT_PROMO_NAMING : DEFAULT_CLIP_NAMING);
}
