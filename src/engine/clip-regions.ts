/**
 * Clip regions on the Media Cutter's audio waveform (spec 05, web only): where each row's clip
 * sits on the track, and what dragging one of its edges writes back into the row.
 */

import { clipRequest, type ClipRow } from "./clips";
import { pyRound } from "./py";
import { formatTimestamp, parseTimestamp } from "./time";

/** A row's clip on the track, in seconds. */
export type ClipRegion = { key: string; start: number; end: number };

/** Dragged edges snap to whole seconds (the fields hold `formatTimestamp` values), so clips stay ≥ 1 s. */
const MIN_CLIP_SECONDS = 1;

/** One region per row that resolves to a clip starting inside the track; its end is clamped to the track. */
export function clipRegions(rows: ClipRow[], duration: number): ClipRegion[] {
  const regions: ClipRegion[] = [];
  for (const row of rows) {
    const result = clipRequest(row);
    if ("error" in result || result.clip.start >= duration) continue;
    regions.push({ key: row.key, start: result.clip.start, end: Math.min(duration, result.clip.start + result.clip.duration) });
  }
  return regions;
}

/**
 * Drag an edge of `row`'s clip to `seconds`: the Start or End text to write, or null when the
 * row's timing doesn't parse. Start moves alone when the row has an End, and slides the clip
 * when it uses Duration. End always writes the End field, like Set End.
 */
export function dragClipEdge(row: ClipRow, edge: "start" | "end", seconds: number, duration: number): { start: string } | { end: string } | null {
  const snapped = pyRound(seconds);
  try {
    const start = parseTimestamp(row.start);
    if (edge === "end") {
      const end = Math.max(Math.floor(start) + MIN_CLIP_SECONDS, Math.min(snapped, Math.ceil(duration)));
      return { end: formatTimestamp(end) };
    }
    const limit = row.end.trim() ? parseTimestamp(row.end) : duration;
    return { start: formatTimestamp(Math.max(0, Math.min(snapped, Math.floor(limit - MIN_CLIP_SECONDS)))) };
  } catch {
    return null;
  }
}

/** The row a click at `seconds` selects: the current region if it's under the click, else the last one that is. */
export function regionAt(regions: ClipRegion[], seconds: number, currentKey: string | null): string | null {
  const under = regions.filter((region) => seconds >= region.start && seconds <= region.end);
  return (under.find((region) => region.key === currentKey) ?? under.at(-1))?.key ?? null;
}
