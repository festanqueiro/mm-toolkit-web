import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { addHistory, clearHistory, historyId, HISTORY_LIMIT, listHistory, localTimestamp } from "../src/storage/history";
import { resetDbForTests } from "../src/storage/db";

beforeEach(async () => {
  await resetDbForTests();
});

describe("history store", () => {
  it("keeps the newest 20, newest first", async () => {
    for (let i = 0; i < HISTORY_LIMIT + 3; i++) {
      await addHistory({ id: historyId(1_000 + i), tool: "promo", created: localTimestamp(new Date(2026, 0, 1, 0, 0, i)), n: i });
    }
    const all = await listHistory();
    expect(all).toHaveLength(HISTORY_LIMIT);
    expect(all[0]!.n).toBe(HISTORY_LIMIT + 2);
    expect(all.at(-1)!.n).toBe(3);
    await clearHistory();
    expect(await listHistory()).toEqual([]);
  });

  it("formats local timestamps with seconds precision", () => {
    expect(localTimestamp(new Date(2026, 9, 2, 14, 3, 11))).toBe("2026-10-02T14:03:11");
  });
});
