/**
 * Video Creator input rules and status messages (spec 04), kept free of DOM/Svelte so they
 * can be unit-tested. Message strings are the desktop's, verbatim.
 */

import { AUDIO_EXTENSIONS, extensionOf, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from "./media-kind";
import { pyRound } from "./py";
import { formatTimestamp, parseTimestamp } from "./time";

export const DEFAULT_TRACK_DURATION = 60;
export const MIN_TRACK_DURATION = 1;
export const MAX_TRACK_DURATION = 3600;

const isAudioName = (name: string) => (AUDIO_EXTENSIONS as readonly string[]).includes(extensionOf(name));

/** Python `str.casefold()` is close enough to `toLowerCase()` for sorting file names. */
const casefold = (name: string) => name.toLowerCase();

/**
 * `find_audio_files` for a folder: direct children only (not recursive), audio extensions
 * only, sorted by case-folded name. `relativePath` is `webkitRelativePath` ("Folder/a.wav");
 * entries nested deeper than one level are dropped. A path-less entry counts as a direct child.
 */
export function audioFilesInFolder<T extends { name: string; relativePath?: string }>(entries: T[]): T[] {
  return entries
    .filter((entry) => isAudioName(entry.name) && (!entry.relativePath || entry.relativePath.split("/").length <= 2))
    .sort((a, b) => {
      const x = casefold(a.name);
      const y = casefold(b.name);
      return x < y ? -1 : x > y ? 1 : 0;
    });
}

/** `find_audio_files` for a single file: itself if it has an audio extension. */
export const audioFilesFromFile = <T extends { name: string }>(file: T): T[] => (isAudioName(file.name) ? [file] : []);

export type VisualKind = "image" | "video";

/** Which validator applies to a visual, by extension (`validate_visual`). */
export function visualKind(name: string): VisualKind | null {
  const ext = extensionOf(name);
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return "image";
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return "video";
  return null;
}

export const VISUAL_MESSAGES = {
  imageReady: "Image ready.",
  videoReady: "Video ready.",
  imageUnreadable: "The selected artwork could not be read.",
  videoUnreadable: "The selected video could not be read.",
  unsupported: "The selected file cannot be used as an image or video.",
} as const;

/** One row of the Audio timestamps table. `start` is the raw text the user typed. */
export type TrackRow = { key: string; name: string; start: string; duration: number };

/**
 * Rebuild rows for a new audio selection, keeping start/duration of tracks that were
 * already listed (desktop keyed by path; the web keys by file identity).
 */
export function mergeTrackRows(previous: TrackRow[], tracks: { key: string; name: string }[], defaultDuration = DEFAULT_TRACK_DURATION): TrackRow[] {
  const old = new Map(previous.map((row) => [row.key, row]));
  return tracks.map(({ key, name }) => {
    const kept = old.get(key);
    return { key, name, start: kept?.start ?? "00:00:00", duration: kept?.duration ?? defaultDuration };
  });
}

export type TrackOption = { start: number; duration: number };

/** `promo_track_options`: parsed rows, or the first row's error as `Track {n}: {message}`. */
export function trackOptions(rows: TrackRow[]): { options: TrackOption[]; error: string | null } {
  const options: TrackOption[] = [];
  for (const [index, row] of rows.entries()) {
    try {
      options.push({ start: parseTimestamp(row.start), duration: row.duration });
    } catch (error) {
      return { options: [], error: `Track ${index + 1}: ${(error as Error).message}` };
    }
  }
  return { options, error: null };
}

export type RequirementState = {
  trackCount: number;
  visualOk: boolean;
  outputOk: boolean;
  trackError: string | null;
  analysing: boolean;
  running: boolean;
};

/** The requirements line next to Generate, and whether Generate is enabled. */
export function requirements(state: RequirementState): { ready: boolean; message: string } {
  if (state.running) return { ready: false, message: "Generating videos…" };
  const musicOk = state.trackCount > 0;
  const missing: string[] = [];
  if (!musicOk) missing.push("choose audio");
  if (!state.visualOk) missing.push("choose a valid image or video");
  if (!state.outputOk) missing.push("choose a writable export folder");
  if (musicOk && state.trackError) missing.push(state.trackError.replace(/\.+$/, ""));
  if (state.analysing) missing.push("wait for drop analysis");
  if (missing.length) return { ready: false, message: `To enable Generate: ${missing.join("; ")}.` };
  return { ready: true, message: "✓ Ready to generate videos." };
}

export const generateLabel = (trackCount: number) => (trackCount === 1 ? "Generate Video" : "Generate Videos");

export const audioStatus = (trackCount: number, hasSelection: boolean) =>
  trackCount > 0 ? `✓ Found ${trackCount} audio file${trackCount !== 1 ? "s" : ""}.` : hasSelection ? "No audio files were found." : "";

/** Estimated duration line: `{per video} • {total} combined`. */
export function durationSummary(options: TrackOption[]): string {
  if (!options.length) return "Select audio to estimate duration.";
  const durations = options.map((o) => o.duration);
  const total = durations.reduce((sum, d) => sum + d, 0);
  const shortest = Math.min(...durations);
  const longest = Math.max(...durations);
  const perVideo =
    Math.abs(shortest - longest) < 0.01
      ? `${formatTimestamp(shortest)} per video`
      : `${formatTimestamp(shortest)}–${formatTimestamp(longest)} per video`;
  return `${perVideo} • ${formatTimestamp(total)} combined`;
}

/** Job estimate line. Free space is only known when exporting through browser storage. */
export function jobSummary(outputCount: number, freeBytes?: number | null): string {
  if (!outputCount) return "Select audio to estimate this job.";
  if (freeBytes == null) return `${outputCount} output(s)`;
  // Python `f"{x:.1f}"` rounds half to even; `toFixed` doesn't.
  return `${outputCount} output(s) • ${(pyRound((freeBytes / 1024 ** 3) * 10) / 10).toFixed(1)} GB free`;
}

/** Python `f"{x:g}"` for the durations shown in preview tooltips/status (1 decimal max in the UI). */
export function formatG(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const text = value.toPrecision(6);
  return text.includes("e") || !text.includes(".") ? text : text.replace(/\.?0+$/, "");
}

export const previewTooltip = (row: Pick<TrackRow, "start" | "duration">) =>
  `Listen from ${row.start || "the start time"} for ${formatG(row.duration)} seconds`;

export const previewStatus = (name: string, start: number, duration: number) =>
  `Listening to ${name} from ${formatTimestamp(start)} for ${formatG(duration)} seconds.`;

export const TIMESTAMPS_HINT = "Edit start times manually or use ✨ to detect a drop for one track.";

export const dropDialogMessage = (track: string) =>
  `MM Toolkit will analyze ${track} and propose a start time based on its main drop.`;
export const dropAnalysingStatus = (name: string) => `Analyzing ${name} for its main drop…`;
export const dropProposedStatus = (name: string, start: number) =>
  `✓ Proposed ${formatTimestamp(start)} for ${name}. You can edit or preview it.`;
export const dropFailedStatus = (message: string) => `Drop detection failed: ${message}. You can still enter the start manually.`;

/** Proposed start for a detected drop: `max(0, drop − leadIn)`, shown via `formatTimestamp`. */
export const proposedStart = (drop: number, leadIn: number) => Math.max(0, drop - leadIn);
