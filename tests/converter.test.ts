import { describe, expect, it } from "vitest";
import {
  convertOutputName,
  convertRequirements,
  detectBatch,
  detectedLabel,
  finishedConversions,
  formatsFor,
  inputStatus,
  keepFormat,
  convertingFile,
} from "../src/engine/converter";

const ok = (name: string) => ({ name, ok: true });

describe("batch detection", () => {
  it("all audio or all video, every file usable", () => {
    expect(detectBatch([ok("a.wav"), ok("b.MP3")])).toEqual({ kind: "audio", count: 2 });
    expect(detectBatch([ok("a.mov")])).toEqual({ kind: "video", count: 1 });
    expect(detectBatch([ok("a.wav"), ok("b.mp4")])).toEqual({ error: "mixed" });
    expect(detectBatch([ok("a.wav"), { name: "b.wav", ok: false }])).toEqual({ error: "unusable" });
    expect(detectBatch([ok("a.wav"), ok("notes.txt")])).toEqual({ error: "unusable" });
    expect(detectBatch([ok("a.wav"), { name: "b.wav", ok: null }])).toEqual({ error: "checking" });
    expect(detectBatch([])).toEqual({ error: "empty" });
  });

  it("statuses and the detected label", () => {
    expect(inputStatus({ kind: "audio", count: 1 })).toBe("✓ 1 audio file ready.");
    expect(inputStatus({ kind: "video", count: 3 })).toBe("✓ 3 video files ready.");
    expect(inputStatus({ error: "mixed" })).toBe("Audio and video files cannot be mixed in one batch.");
    expect(inputStatus({ error: "unusable" })).toBe("One or more selected files cannot be used.");
    expect(detectedLabel({ kind: "video", count: 1 })).toBe("Video");
    expect(detectedLabel({ error: "mixed" })).toBe("Not detected");
  });
});

describe("formats", () => {
  it("lists per kind and keeps a still-valid choice", () => {
    expect(formatsFor("audio")).toEqual(["mp3", "wav", "aiff", "flac", "m4a", "aac", "ogg"]);
    expect(formatsFor("video")).toEqual(["mp4", "mov", "mkv", "avi", "webm"]);
    expect(formatsFor(null)).toEqual([]);
    expect(keepFormat("flac", formatsFor("audio"))).toBe("flac");
    expect(keepFormat("flac", formatsFor("video"))).toBe("mp4");
    expect(keepFormat(null, formatsFor("audio"))).toBe("mp3");
    // AVI is listed but can't be chosen in the browser yet (ADR-004).
    expect(keepFormat("avi", formatsFor("video"))).toBe("mp4");
    expect(keepFormat(null, [])).toBeNull();
  });

  it("names: source stem + format, no template", () => {
    expect(convertOutputName("Live Set.final.wav", "flac")).toBe("Live Set.final.flac");
    expect(convertOutputName("clip.MOV", "mp4")).toBe("clip.mp4");
    expect(convertOutputName("noext", "mp3")).toBe("noext.mp3");
  });
});

describe("requirements and progress", () => {
  const base = { outputOk: true, running: false, bitrate: "320k" as const };
  it("lists what is missing", () => {
    expect(convertRequirements({ ...base, batch: { error: "mixed" }, format: null, outputOk: false }).message).toBe(
      "To enable Convert: choose a valid audio-only or video-only batch; choose a writable export folder.",
    );
  });
  it("ready line, with the MP3 bitrate", () => {
    expect(convertRequirements({ ...base, batch: { kind: "audio", count: 2 }, format: "mp3", bitrate: "192k" })).toEqual({
      ready: true,
      message: "✓ Ready to convert 2 files to MP3 at 192 kbps.",
    });
    expect(convertRequirements({ ...base, batch: { kind: "video", count: 1 }, format: "webm" }).message).toBe("✓ Ready to convert 1 file to WEBM.");
    expect(convertRequirements({ ...base, batch: { kind: "video", count: 1 }, format: "webm", running: true }).message).toBe("Converting files…");
  });
  it("progress strings", () => {
    expect(convertingFile("a.wav", 0, 3)).toBe("Converting a.wav (1 of 3)");
    expect(finishedConversions(1)).toBe("Finished 1 conversion");
    expect(finishedConversions(2)).toBe("Finished 2 conversions");
  });
});
