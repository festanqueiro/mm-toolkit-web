import { describe, expect, it } from "vitest";
import {
  clipOutputFormat,
  clipOutputName,
  clipRequest,
  clipRequests,
  clipRequirements,
  clipStatus,
  createLabel,
  defaultClipTitle,
  editingLabel,
  emptyClipRow,
  finishedClips,
  outputFormatStatus,
  pyStr,
  rowsFromHistory,
  sourceReady,
} from "../src/engine/clips";
import { formatTimestamp } from "../src/engine/time";

const row = (start: string, end = "", duration = "60", title = "") => ({ title, start, end, duration });

describe("clip resolution (clip_request)", () => {
  it("start is required", () => {
    expect(clipRequest(row(""))).toEqual({ error: "enter a start timestamp." });
    expect(clipRequest(row("  "))).toEqual({ error: "enter a start timestamp." });
  });

  it("end wins over duration", () => {
    expect(clipRequest(row("00:01:00", "01:30", "5"))).toEqual({ clip: { title: "", start: 60, duration: 30 } });
    expect(clipRequest(row("10", "10"))).toEqual({ error: "End must be later than start." });
    expect(clipRequest(row("10", "9"))).toEqual({ error: "End must be later than start." });
  });

  it("duration defaults to 60 and must be positive", () => {
    expect(clipRequest(row("5", "", ""))).toEqual({ clip: { title: "", start: 5, duration: 60 } });
    expect(clipRequest(row("5", "", "1:30"))).toEqual({ clip: { title: "", start: 5, duration: 90 } });
    expect(clipRequest(row("5", "", "0"))).toEqual({ error: "Duration must be greater than zero." });
  });

  it("timestamp errors carry parseTimestamp's message", () => {
    expect(clipRequest(row("1:75"))).toEqual({ error: "Invalid timestamp: 1:75" });
    expect(clipRequest(row("0", "abc"))).toEqual({ error: "Invalid timestamp: abc" });
  });

  it("titles are trimmed", () => {
    expect(clipRequest(row("0", "", "1", "  Intro "))).toEqual({ clip: { title: "Intro", start: 0, duration: 1 } });
  });

  it("the first failing row blocks the job", () => {
    const result = clipRequests([row("0"), row(""), row("x")]);
    expect(result).toEqual({ clips: [], error: "Clip 2: enter a start timestamp." });
    expect(clipStatus(result)).toBe("Clip 2: enter a start timestamp.");
    expect(clipStatus(clipRequests([row("0")]))).toBe("✓ 1 clip ready.");
    expect(clipStatus(clipRequests([row("0"), row("1")]))).toBe("✓ 2 clips ready.");
  });
});

describe("output format and naming", () => {
  it("video → mp4, audio keeps its format", () => {
    expect(clipOutputFormat("a.MOV")).toBe("mp4");
    expect(clipOutputFormat("a.webm")).toBe("mp4");
    expect(clipOutputFormat("a.WAVE")).toBe("wav");
    expect(clipOutputFormat("a.aif")).toBe("aiff");
    expect(clipOutputFormat("a.aiff")).toBe("aiff");
    for (const ext of ["mp3", "wav", "flac", "m4a", "aac", "ogg"]) expect(clipOutputFormat(`a.${ext}`)).toBe(ext);
    expect(clipOutputFormat("a.png")).toBeNull();
  });

  it("status strings", () => {
    expect(outputFormatStatus("audio", "aiff")).toBe("✓ Audio clips will be exported as AIFF files.");
    expect(outputFormatStatus("video", "mp4")).toBe("✓ Video clips will be exported as MP4 files.");
    expect(sourceReady("video")).toBe("✓ Source video ready.");
    expect(createLabel(null)).toBe("Create Media Clips");
    expect(createLabel("audio")).toBe("Create Audio Clips");
    expect(finishedClips(1)).toBe("Finished 1 clip");
    expect(finishedClips(3)).toBe("Finished 3 clips");
  });

  it("names: {source} stem, {title} or Clip NN, 1-based {number}, made safe", () => {
    expect(clipOutputName("{source} - {title}", "Live Set.wav", "", 0, "wav")).toBe("Live Set - Clip 01.wav");
    expect(clipOutputName("{number:03d}_{title}", "x.mp3", "", 2, "mp3")).toBe("003_Clip 03.mp3");
    expect(clipOutputName("{source}/{title}", "Live Set.mov", "Drop: 1", 0, "mp4")).toBe("Live Set-Drop- 1.mp4");
    expect(defaultClipTitle(9)).toBe("Clip 10");
    expect(() => clipOutputName("{track}", "a.wav", "", 0, "wav")).toThrow("Invalid clip naming template. Use {source}, {title}, and {number}.");
  });
});

describe("requirements and labels", () => {
  it("lists what is missing, in desktop order", () => {
    expect(clipRequirements({ sourceOk: false, clipError: "Clip 1: enter a start timestamp.", outputOk: false, running: false }).message).toBe(
      "To enable Create Clips: choose valid source media; Clip 1: enter a start timestamp; choose a writable export folder.",
    );
    expect(clipRequirements({ sourceOk: true, clipError: null, outputOk: true, running: false })).toEqual({ ready: true, message: "✓ Ready to create clips." });
    expect(clipRequirements({ sourceOk: true, clipError: null, outputOk: true, running: true })).toEqual({ ready: false, message: "Creating clips…" });
  });

  it("editing label", () => {
    expect(editingLabel(null, -1)).toBe("Editing: select a clip");
    expect(editingLabel({ ...emptyClipRow(), title: "Hook" }, 0)).toBe("Editing: Hook");
    expect(editingLabel(emptyClipRow(), 1)).toBe("Editing: Clip 02");
  });

  it("history rows: Start formatted, End empty, Duration as Python str", () => {
    const rows = rowsFromHistory([{ title: "Intro", start: 12, duration: 30 }, { title: "", start: 1.5, duration: 12.5 }], formatTimestamp);
    expect(rows.map(({ title, start, end, duration }) => ({ title, start, end, duration }))).toEqual([
      { title: "Intro", start: "00:00:12", end: "", duration: "30.0" },
      { title: "", start: "00:00:02", end: "", duration: "12.5" },
    ]);
    expect(pyStr(60)).toBe("60.0");
  });
});
