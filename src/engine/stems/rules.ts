/** Stem Splitter rules and messages (spec 15), free of DOM/Svelte. */
import type { MediaKind } from "../media-kind";

export const STEM_CHOICES = ["vocals", "drums", "bass", "other", "instrumental"] as const;
export type StemChoice = (typeof STEM_CHOICES)[number];

export const STEM_LABELS: Record<StemChoice, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  other: "Other",
  instrumental: "Instrumental",
};

/** Instrumental = everything but vocals. */
export const STEM_HINTS: Partial<Record<StemChoice, string>> = { instrumental: "Drums, bass and other mixed together" };

export const DEFAULT_STEMS: StemChoice[] = ["vocals", "instrumental"];

/** Keep the canonical order whatever order they were ticked in. */
export const orderStems = (stems: StemChoice[]) => STEM_CHOICES.filter((s) => stems.includes(s));

export const STEM_FORMATS = ["wav", "aiff", "flac", "mp3", "m4a", "aac", "ogg"] as const;
export type StemFormat = (typeof STEM_FORMATS)[number];

/** `{source stem} - {Stem}.{ext}`. */
export function stemOutputName(sourceName: string, stem: StemChoice, format: StemFormat): string {
  const dot = sourceName.lastIndexOf(".");
  return `${dot > 0 ? sourceName.slice(0, dot) : sourceName} - ${STEM_LABELS[stem]}.${format}`;
}

export const stemsStatus = (n: number) => (n ? `✓ ${n} stem${n === 1 ? "" : "s"} selected.` : "Choose at least one stem.");

export const SOURCE_READY = "✓ Source ready.";

export type StemRequirementState = { sourceOk: boolean; stems: number; outputOk: boolean; running: boolean };

export function stemRequirements(state: StemRequirementState): { ready: boolean; message: string } {
  if (state.running) return { ready: false, message: "Splitting stems…" };
  const missing: string[] = [];
  if (!state.sourceOk) missing.push("choose a source");
  if (!state.stems) missing.push("choose at least one stem");
  if (!state.outputOk) missing.push("choose a writable export folder");
  if (missing.length) return { ready: false, message: `To enable Split Stems: ${missing.join("; ")}.` };
  return { ready: true, message: "✓ Ready to split stems." };
}

export const STEM_PROGRESS = {
  writing: "Writing stems…",
  cancelling: "Cancelling safely…",
  cancelled: "Cancelled. Partial files were removed.",
} as const;

export const downloadingModel = (fraction: number) => `Downloading model… ${Math.floor(fraction * 100)}%`;
export const preparing = (name: string) => `Preparing ${name}…`;
export const separating = (name: string, i: number, n: number) => `Separating ${name} (${i + 1} of ${n})`;
export const finishedStems = (n: number) => `Finished ${n} stem${n === 1 ? "" : "s"}`;

export const STEM_MESSAGES = {
  noWebGpu: "This browser has no WebGPU, so separation runs on the CPU (slower: several minutes per song).",
  downloadFailed: "The stem model could not be downloaded. Check your connection and try again.",
  damaged: "The downloaded stem model is damaged. Try again.",
  modelPending: "Model: HT-Demucs (170 MB, downloaded once)",
  modelReady: "✓ Model ready on this device",
} as const;

/** Video sources are fine: their soundtrack is split. */
export const usableKind = (kind: MediaKind | null) => kind !== null;
