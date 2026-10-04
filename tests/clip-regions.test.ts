import { describe, expect, it } from "vitest";
import { clipRegions, dragClipEdge, regionAt } from "../src/engine/clip-regions";

const row = (key: string, start: string, end: string, duration = "60") => ({ key, title: "", start, end, duration });

describe("clipRegions", () => {
  it("a row with an End spans start → end", () => {
    expect(clipRegions([row("a", "00:00:05", "00:00:20")], 100)).toEqual([{ key: "a", start: 5, end: 20 }]);
  });

  it("a row without an End spans start → start + duration", () => {
    expect(clipRegions([row("a", "10", "", "15")], 100)).toEqual([{ key: "a", start: 10, end: 25 }]);
  });

  it("a clip running past the end of the track is drawn up to the end", () => {
    expect(clipRegions([row("a", "00:00:04", "", "60")], 10)).toEqual([{ key: "a", start: 4, end: 10 }]);
  });

  it("rows that don't resolve, or start at or past the end, have no region", () => {
    const rows = [row("empty", "", ""), row("bad", "abc", ""), row("backwards", "20", "10"), row("late", "10", "", "5"), row("ok", "1", "2")];
    expect(clipRegions(rows, 10).map((r) => r.key)).toEqual(["ok"]);
  });

  it("no regions before the track's duration is known", () => {
    expect(clipRegions([row("a", "0", "5")], 0)).toEqual([]);
  });
});

describe("dragClipEdge", () => {
  it("start, row with an End: moves Start alone, snapped to a whole second", () => {
    expect(dragClipEdge(row("a", "00:00:05", "00:00:20"), "start", 12.3, 100)).toEqual({ start: "00:00:12" });
  });

  it("start, row with an End: stops one second before End", () => {
    expect(dragClipEdge(row("a", "00:00:05", "00:00:20"), "start", 50, 100)).toEqual({ start: "00:00:19" });
  });

  it("start, row using Duration: slides the clip and leaves End empty", () => {
    expect(dragClipEdge(row("a", "00:00:05", "", "15"), "start", 40.6, 100)).toEqual({ start: "00:00:41" });
  });

  it("start never goes below zero or onto the end of the track", () => {
    expect(dragClipEdge(row("a", "00:00:05", "", "15"), "start", -3, 100)).toEqual({ start: "00:00:00" });
    expect(dragClipEdge(row("a", "00:00:05", "", "15"), "start", 500, 10)).toEqual({ start: "00:00:09" });
  });

  it("end: writes End, snapped to a whole second", () => {
    expect(dragClipEdge(row("a", "00:00:05", "", "60"), "end", 31.7, 100)).toEqual({ end: "00:00:32" });
  });

  it("end: stops one second after Start", () => {
    expect(dragClipEdge(row("a", "00:00:05", "00:00:20"), "end", 2, 100)).toEqual({ end: "00:00:06" });
  });

  it("end: stops at the end of the track (rounded up so the tail is reachable)", () => {
    expect(dragClipEdge(row("a", "00:00:05", "00:00:08"), "end", 500, 10.03)).toEqual({ end: "00:00:11" });
  });

  it("snaps halves the way formatTimestamp does (banker's rounding)", () => {
    expect(dragClipEdge(row("a", "0", "00:00:20"), "start", 2.5, 100)).toEqual({ start: "00:00:02" });
    expect(dragClipEdge(row("a", "0", "00:00:20"), "start", 3.5, 100)).toEqual({ start: "00:00:04" });
  });

  it("a row whose Start doesn't parse can't be dragged", () => {
    expect(dragClipEdge(row("a", "abc", ""), "end", 5, 100)).toBeNull();
  });
});

describe("regionAt", () => {
  const regions = [
    { key: "a", start: 2, end: 6 },
    { key: "b", start: 5, end: 9 },
  ];

  it("the region under a time, or null outside every region", () => {
    expect(regionAt(regions, 3, null)).toBe("a");
    expect(regionAt(regions, 8, null)).toBe("b");
    expect(regionAt(regions, 9.5, null)).toBeNull();
  });

  it("where regions overlap, the current one keeps the click; otherwise the later row wins", () => {
    expect(regionAt(regions, 5.5, "a")).toBe("a");
    expect(regionAt(regions, 5.5, null)).toBe("b");
  });
});
