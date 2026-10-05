/**
 * Regions on the audio waveforms (web only): where a Media Cutter clip (spec 05) or a Video
 * Creator track's snippet (spec 04) sits on its file, and what dragging one of its edges
 * writes back into the row.
 */

import { clipRequest, type ClipRow } from "./clips";
import { pyRound } from "./py";
import { MAX_TRACK_DURATION, MIN_TRACK_DURATION, type TrackRow } from "./video-creator";
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

// ------------------------------------------------------------------ Video Creator

/** A track's snippet on its file (its end clamped to the file), or null when Start doesn't resolve inside it. */
export function trackRegion(row: TrackRow, duration: number): ClipRegion | null {
  try {
    const start = parseTimestamp(row.start);
    return start < duration ? { key: row.key, start, end: Math.min(duration, start + row.duration) } : null;
  } catch {
    return null;
  }
}

/**
 * Drag an edge of a track's snippet to `seconds`. The start handle slides the snippet (Start,
 * whole seconds); the end handle writes Duration with the field's limits and one decimal.
 */
export function dragTrackEdge(row: TrackRow, edge: "start" | "end", seconds: number, duration: number): { start: string } | { duration: number } | null {
  try {
    const start = parseTimestamp(row.start);
    if (edge === "start") return { start: formatTimestamp(Math.max(0, Math.min(pyRound(seconds), Math.floor(duration - MIN_CLIP_SECONDS)))) };
    const length = Math.round((Math.min(seconds, duration) - start) * 10) / 10;
    return { duration: Math.min(MAX_TRACK_DURATION, Math.max(MIN_TRACK_DURATION, length)) };
  } catch {
    return null;
  }
}

export type HandleZone = { left: number; width: number };

/** How far a handle's grab zone reaches outside its clip, and (at most) inside it, in pixels. */
const ZONE_OUTSIDE = 20;
const ZONE_INSIDE = 12;
const ZONE_MIN = 24;

/**
 * Where the two handles of a clip can be grabbed, in pixels along a track `width` wide. A zone
 * straddles its edge: mostly outside the clip, and inside by up to a third of it, so the two
 * never overlap. At an end of the track a zone folds inward and the other one makes room.
 */
export function handleZones(startX: number, endX: number, width: number): { start: HandleZone; end: HandleZone } {
  const inside = Math.min(ZONE_INSIDE, Math.max(0, endX - startX) / 3);
  const folded = startX - ZONE_OUTSIDE < 0;
  let startLeft = Math.max(0, startX - ZONE_OUTSIDE);
  let startRight = Math.max(startX + inside, startLeft + ZONE_MIN);
  let endRight = Math.min(width, endX + ZONE_OUTSIDE);
  let endLeft = Math.min(endX - inside, endRight - ZONE_MIN);
  if (startRight > endLeft) {
    if (folded) {
      endLeft = startRight;
      endRight = Math.max(endRight, endLeft + ZONE_MIN);
    } else {
      startRight = endLeft;
      startLeft = Math.min(startLeft, startRight - ZONE_MIN);
    }
  }
  return { start: { left: startLeft, width: startRight - startLeft }, end: { left: endLeft, width: endRight - endLeft } };
}
