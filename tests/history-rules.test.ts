import { describe, expect, it } from "vitest";
import { evictOldest, formatBytes, historyItemLabel, historyKey, historyTabLabel, reselectHint, reselectNames } from "../src/engine/history";

describe("History rules", () => {
  it("item labels", () => {
    expect(historyItemLabel({ created: "2026-10-02T14:03:11", tool: "promo", source: { name: "Set", kind: "directory" } })).toBe(
      "2026-10-02T14:03:11  •  Video Creator  •  Set",
    );
    expect(historyItemLabel({ created: "2026-10-02T14:03:11", tool: "clips", source: null })).toBe("2026-10-02T14:03:11  •  Media Cutter  •  Unknown input");
    expect(historyItemLabel({ created: "x", tool: "converter", source: { name: "" } })).toBe("x  •  Media Converter  •  Unknown input");
  });

  it("selection key and tab label", () => {
    expect(historyKey({ created: "c", tool: "clips", source: { name: "a.wav" } })).toBe("c|clips|a.wav");
    expect(historyTabLabel(0)).toBe("History");
    expect(historyTabLabel(3)).toBe("History (3)");
  });

  it("inputs to re-select per tool", () => {
    expect(reselectNames({ tool: "promo", source: { name: "Set" }, cover: { name: "art.png" } })).toEqual(["Set", "art.png"]);
    expect(reselectNames({ tool: "clips", source: { name: "mix.wav" } })).toEqual(["mix.wav"]);
    expect(reselectNames({ tool: "converter", sources: [{ name: "a.wav" }, { name: "b.wav" }, { name: "c.wav" }] })).toEqual(["a.wav", "b.wav", "c.wav"]);
    expect(reselectHint(["a.wav"])).toBe("Re-select a.wav");
    expect(reselectHint(["a.wav", "b.wav"])).toBe("Re-select a.wav and b.wav");
    expect(reselectHint(["a.wav", "b.wav", "c.wav", "d.wav"])).toBe("Re-select a.wav, b.wav and 2 more");
  });

  it("bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.0 GB");
  });

  it("evicts oldest job folders until under the cap, never the running one", () => {
    const jobs = [
      { id: "003", bytes: 50 },
      { id: "001", bytes: 40 },
      { id: "002", bytes: 30 },
    ];
    expect(evictOldest(jobs, 100)).toEqual(["001"]);
    expect(evictOldest(jobs, 60)).toEqual(["001", "002"]);
    expect(evictOldest(jobs, 60, ["001"])).toEqual(["002", "003"]);
    expect(evictOldest(jobs, 1000)).toEqual([]);
  });
});
