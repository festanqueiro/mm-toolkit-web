/**
 * Media Converter rules and status messages (spec 06), free of DOM/Svelte so they can be
 * unit-tested. Message strings are the desktop's, verbatim.
 */
import { AUDIO_OUTPUT_FORMATS, mediaKind, VIDEO_OUTPUT_FORMATS, type MediaKind } from "./media-kind";

export type OutputFormatName = (typeof AUDIO_OUTPUT_FORMATS)[number] | (typeof VIDEO_OUTPUT_FORMATS)[number];

export const MP3_BITRATES = ["128k", "192k", "256k", "320k"] as const;
export type Mp3Bitrate = (typeof MP3_BITRATES)[number];
export const DEFAULT_MP3_BITRATE: Mp3Bitrate = "320k";

/** A batch entry as the UI sees it: `ok` once the file probed as usable media. */
export type BatchEntry = { name: string; ok: boolean | null };

export type BatchState =
  | { kind: MediaKind; count: number }
  | { error: "empty" | "checking" | "unusable" | "mixed" };

/** All audio or all video, every file usable (`media_kind` + a header probe). */
export function detectBatch(entries: BatchEntry[]): BatchState {
  if (!entries.length) return { error: "empty" };
  if (entries.some((e) => e.ok === null)) return { error: "checking" };
  const kinds = new Set(entries.map((e) => (e.ok ? mediaKind(e.name) : null)));
  if (kinds.has(null)) return { error: "unusable" };
  if (kinds.size !== 1) return { error: "mixed" };
  return { kind: [...kinds][0]!, count: entries.length };
}

export function inputStatus(state: BatchState): string {
  if ("kind" in state) return `✓ ${state.count} ${state.kind} file${state.count === 1 ? "" : "s"} ready.`;
  switch (state.error) {
    case "mixed":
      return "Audio and video files cannot be mixed in one batch.";
    case "unusable":
      return "One or more selected files cannot be used.";
    case "checking":
      return "Checking…";
    case "empty":
      return "";
  }
}

export const detectedLabel = (state: BatchState) => ("kind" in state ? (state.kind === "audio" ? "Audio" : "Video") : "Not detected");

export const formatsFor = (kind: MediaKind | null): readonly OutputFormatName[] =>
  kind === "audio" ? AUDIO_OUTPUT_FORMATS : kind === "video" ? VIDEO_OUTPUT_FORMATS : [];

/**
 * Formats the web can't write yet. AVI needs MPEG-4 Part 2 + an AVI muxer (ffmpeg.wasm);
 * ADR-004 decides whether to ship that or drop AVI.
 */
export const UNAVAILABLE_FORMATS: Partial<Record<OutputFormatName, string>> = {
  avi: "AVI output isn't available in the browser yet. Use MP4, MOV, MKV or WebM, or the desktop app.",
};

/** Keep the previous choice while it's still offered (and available), else the first usable one. */
export function keepFormat(previous: OutputFormatName | null, offered: readonly OutputFormatName[]): OutputFormatName | null {
  const usable = offered.filter((f) => !UNAVAILABLE_FORMATS[f]);
  return previous && usable.includes(previous) ? previous : (usable[0] ?? null);
}

export type ConvertRequirementState = { batch: BatchState; outputOk: boolean; running: boolean; format: OutputFormatName | null; bitrate: Mp3Bitrate };

export function convertRequirements(state: ConvertRequirementState): { ready: boolean; message: string } {
  if (state.running) return { ready: false, message: "Converting files…" };
  const missing: string[] = [];
  const batchOk = "kind" in state.batch && !!state.format;
  if (!batchOk) missing.push("choose a valid audio-only or video-only batch");
  if (!state.outputOk) missing.push("choose a writable export folder");
  if (missing.length) return { ready: false, message: `To enable Convert: ${missing.join("; ")}.` };
  const n = (state.batch as { count: number }).count;
  const bitrate = state.format === "mp3" ? ` at ${parseInt(state.bitrate, 10)} kbps` : "";
  return { ready: true, message: `✓ Ready to convert ${n} file${n === 1 ? "" : "s"} to ${state.format!.toUpperCase()}${bitrate}.` };
}

export const CONVERT_PROGRESS = {
  preparing: "Preparing conversion…",
  cancelling: "Cancelling safely…",
  cancelled: "Conversion cancelled. Partial files were removed.",
} as const;

export const convertingFile = (name: string, i: number, n: number) => `Converting ${name} (${i + 1} of ${n})`;
export const finishedConversions = (n: number) => `Finished ${n} conversion${n === 1 ? "" : "s"}`;

/** `{source stem}.{format}` (no template, no sanitising: the stem is already a valid name). */
export function convertOutputName(sourceName: string, format: OutputFormatName): string {
  const dot = sourceName.lastIndexOf(".");
  return `${dot > 0 ? sourceName.slice(0, dot) : sourceName}.${format}`;
}

export const CONVERTER_DOWNLOADS = "Converted files are saved to your browser's Downloads folder.";
