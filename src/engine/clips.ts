/**
 * Media Cutter rules and status messages (spec 05), free of DOM/Svelte so they can be
 * unit-tested. Message strings are the desktop's, verbatim.
 */

import { extensionOf, mediaKind, type MediaKind } from "./media-kind";
import { safeFilename } from "./naming";
import { CLIP_TEMPLATE_ERROR, formatTemplate } from "./template";
import { parseTimestamp } from "./time";

export const DEFAULT_CLIP_DURATION = "60";

/** One row of the Clip timestamps table; every field is the raw text the user typed. */
export type ClipRow = { key: string; title: string; start: string; end: string; duration: string };

/** A resolved clip (`ClipRequest`): seconds. */
export type ClipRequest = { title: string; start: number; duration: number };

let nextKey = 1;
export const emptyClipRow = (): ClipRow => ({ key: `clip-${nextKey++}`, title: "", start: "00:00:00", end: "", duration: DEFAULT_CLIP_DURATION });

/** `Clip {NN}`: the placeholder and default title for row `index` (0-based). */
export const defaultClipTitle = (index: number) => `Clip ${String(index + 1).padStart(2, "0")}`;

export const clipTitle = (title: string, index: number) => title.trim() || defaultClipTitle(index);

/** `clip_request`: one row → a clip, or the desktop's error (without the `Clip {n}: ` prefix). */
export function clipRequest(row: Omit<ClipRow, "key">): { clip: ClipRequest } | { error: string } {
  if (!row.start.trim()) return { error: "enter a start timestamp." };
  try {
    const start = parseTimestamp(row.start);
    if (row.end.trim()) {
      const duration = parseTimestamp(row.end) - start;
      if (duration <= 0) return { error: "End must be later than start." };
      return { clip: { title: row.title.trim(), start, duration } };
    }
    const duration = parseTimestamp(row.duration.trim() || DEFAULT_CLIP_DURATION);
    if (duration <= 0) return { error: "Duration must be greater than zero." };
    return { clip: { title: row.title.trim(), start, duration } };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** Every row resolved, or the first failing row's error as `Clip {n}: {error}`. */
export function clipRequests(rows: Omit<ClipRow, "key">[]): { clips: ClipRequest[]; error: string | null } {
  const clips: ClipRequest[] = [];
  for (const [index, row] of rows.entries()) {
    const result = clipRequest(row);
    if ("error" in result) return { clips: [], error: `Clip ${index + 1}: ${result.error}` };
    clips.push(result.clip);
  }
  return { clips, error: null };
}

export const clipStatus = (result: { clips: ClipRequest[]; error: string | null }) =>
  result.error ?? `✓ ${result.clips.length} clip${result.clips.length === 1 ? "" : "s"} ready.`;

// ------------------------------------------------------------------ Source & output

export const SOURCE_STATUS = {
  notFound: "The source media could not be found.",
  unsupported: "The selected file is not supported audio or video.",
} as const;

export const sourceReady = (kind: MediaKind) => `✓ Source ${kind} ready.`;

/** `Audio` / `Video`, or `Media` before a source is chosen (group title, button label). */
export const kindWord = (kind: MediaKind | null) => (kind === "audio" ? "Audio" : kind === "video" ? "Video" : "Media");

export const createLabel = (kind: MediaKind | null) => `Create ${kindWord(kind)} Clips`;

export type ClipFormat = "mp4" | "mp3" | "wav" | "aiff" | "flac" | "m4a" | "aac" | "ogg";

/** Video → MP4; audio keeps the source format (`.wave` → wav, `.aif` → aiff). Null for unsupported sources. */
export function clipOutputFormat(sourceName: string): ClipFormat | null {
  const kind = mediaKind(sourceName);
  if (kind === "video") return "mp4";
  if (kind !== "audio") return null;
  const ext = extensionOf(sourceName).slice(1);
  return ({ wave: "wav", aif: "aiff" } as Record<string, ClipFormat>)[ext] ?? (ext as ClipFormat);
}

export const outputFormatStatus = (kind: MediaKind, format: ClipFormat) =>
  `✓ ${kindWord(kind)} clips will be exported as ${format.toUpperCase()} files.`;

export const CLIPS_DOWNLOADS = "Clips are saved to your browser's Downloads folder.";

const stem = (name: string) => (name.lastIndexOf(".") > 0 ? name.slice(0, name.lastIndexOf(".")) : name);

/** Output name for clip `index` before conflict handling: template → `safeFilename` → extension. */
export function clipOutputName(template: string, sourceName: string, title: string, index: number, format: ClipFormat): string {
  let formatted: string;
  try {
    formatted = formatTemplate(template, { source: stem(sourceName), title: clipTitle(title, index), number: index + 1 });
  } catch (error) {
    throw new Error(CLIP_TEMPLATE_ERROR, { cause: error });
  }
  return `${safeFilename(formatted)}.${format}`;
}

// ------------------------------------------------------------------ Footer

export type ClipRequirementState = { sourceOk: boolean; clipError: string | null; outputOk: boolean; running: boolean };

/** The requirements line next to Create, and whether Create is enabled. */
export function clipRequirements(state: ClipRequirementState): { ready: boolean; message: string } {
  if (state.running) return { ready: false, message: "Creating clips…" };
  const missing: string[] = [];
  if (!state.sourceOk) missing.push("choose valid source media");
  if (state.clipError) missing.push(state.clipError.replace(/\.+$/, ""));
  if (!state.outputOk) missing.push("choose a writable export folder");
  if (missing.length) return { ready: false, message: `To enable Create Clips: ${missing.join("; ")}.` };
  return { ready: true, message: "✓ Ready to create clips." };
}

export const CLIP_PROGRESS = {
  preparing: "Preparing clips…",
  cancelling: "Cancelling safely…",
  cancelled: "Cancelled. Partial files were removed.",
} as const;

export const creatingClip = (i: number, n: number) => `Creating clip ${i + 1} of ${n}`;
export const finishedClips = (n: number) => `Finished ${n} clip${n === 1 ? "" : "s"}`;

/** `Editing: {title or Clip NN}`, or a prompt when no row is current. */
export const editingLabel = (row: ClipRow | null, index: number) =>
  row ? `Editing: ${clipTitle(row.title, index)}` : "Editing: select a clip";

/** History → form: Title / Start (`formatTimestamp`) / End empty / Duration (`str(duration)`). */
export function rowsFromHistory(clips: ClipRequest[], format: (seconds: number) => string): ClipRow[] {
  return clips.map((clip) => ({ ...emptyClipRow(), title: clip.title, start: format(clip.start), duration: pyStr(clip.duration) }));
}

/** Python `str(float)` for the values History stores (`30.0`, `12.5`). */
export function pyStr(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}
