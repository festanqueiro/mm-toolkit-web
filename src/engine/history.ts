/** History tab rules (spec 07), free of DOM/Svelte. Strings are the desktop's. */

export type HistoryTool = "promo" | "clips" | "converter" | "stems";

export const TOOL_LABELS: Record<HistoryTool, string> = { promo: "Video Creator", clips: "Media Cutter", converter: "Media Converter", stems: "Stem Splitter" };
export const TOOL_ROUTES: Record<HistoryTool, string> = { promo: "video-creator", clips: "cutter", converter: "converter", stems: "stems" };

/** A file or folder reference as stored in History (`{ name, … }`), or legacy/absent. */
type NamedRef = { name?: unknown } | null | undefined;

const refName = (ref: unknown): string | null => {
  const name = (ref as NamedRef)?.name;
  return typeof name === "string" && name ? name : null;
};

/** `{created}  •  {tool}  •  {source name or "Unknown input"}` (two spaces around the bullet). */
export function historyItemLabel(record: { created: string; tool: HistoryTool; source?: unknown }): string {
  return `${record.created}  •  ${TOOL_LABELS[record.tool] ?? record.tool}  •  ${refName(record.source) ?? "Unknown input"}`;
}

/** Selection survives a refresh while a record with the same created + tool + source exists. */
export const historyKey = (record: { created: string; tool: string; source?: unknown }) => `${record.created}|${record.tool}|${refName(record.source) ?? ""}`;

export const HISTORY_STATUS = {
  none: "No rendered files found for this job.",
  select: "Select a job to preview its rendered files.",
  loadedTimings: "✓ Loaded saved per-track timings.",
} as const;

/** The History tab label: `History ({n})` while there are unseen finished jobs. */
export const historyTabLabel = (unread: number) => (unread > 0 ? `History (${unread})` : "History");

/** Names of a record's inputs that the user must pick again (files aren't persisted on the web). */
export function reselectNames(record: Record<string, unknown>): string[] {
  switch (record.tool) {
    case "promo":
      return [refName(record.source), refName(record.cover)].filter((n): n is string => !!n);
    case "clips":
    case "stems":
      return [refName(record.source)].filter((n): n is string => !!n);
    case "converter": {
      const sources = Array.isArray(record.sources) ? record.sources.map(refName) : [refName(record.source)];
      return sources.filter((n): n is string => !!n);
    }
    default:
      return [];
  }
}

export const reselectHint = (names: string[]) =>
  names.length <= 2 ? `Re-select ${names.join(" and ")}` : `Re-select ${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;

/** Bytes as `12.3 MB` / `1.2 GB` (one decimal, binary units like the desktop's free-space line). */
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${units[unit]}`;
}

/** Staged-output retention cap when "Keep copies of outputs for History" is on. */
export const KEEP_COPIES_CAP = 2 * 1024 ** 3;

/**
 * Oldest-first eviction: given job folders `(id, bytes)` (ids sort oldest first), the ids to
 * delete so the rest fits in `cap`. Ids in `keep` (the running job) are never evicted.
 */
export function evictOldest(jobs: { id: string; bytes: number }[], cap: number, keep: string[] = []): string[] {
  let total = jobs.reduce((sum, job) => sum + job.bytes, 0);
  const evict: string[] = [];
  for (const job of [...jobs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (total <= cap) break;
    if (keep.includes(job.id)) continue;
    evict.push(job.id);
    total -= job.bytes;
  }
  return evict;
}
