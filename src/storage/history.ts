/** Job history (spec 07): newest first, at most 20 records, in the IndexedDB `history` store. */
import { dbClear, dbEntries, dbDelete, dbSet } from "./db";

export const HISTORY_LIMIT = 20;

export type HistoryRecord = { id: string; tool: "promo" | "clips" | "converter" | "stems"; created: string } & Record<string, unknown>;

/** Local ISO timestamp with seconds precision, like desktop `datetime.now().isoformat(timespec="seconds")`. */
export function localTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Sortable id: zero-padded epoch milliseconds plus a random suffix (newest sorts last). */
export const historyId = (now = Date.now()) => `${String(now).padStart(15, "0")}-${Math.random().toString(36).slice(2, 8)}`;

export async function listHistory(): Promise<HistoryRecord[]> {
  const entries = await dbEntries<HistoryRecord>("history");
  return entries.map(([, record]) => record).sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** Insert at the top and trim to the newest 20. */
export async function addHistory(record: HistoryRecord): Promise<void> {
  await dbSet("history", record.id, record);
  const all = await listHistory();
  for (const old of all.slice(HISTORY_LIMIT)) await dbDelete("history", old.id);
}

export const clearHistory = () => dbClear("history");
