import { describe, expect, it } from "vitest";
import {
  audioFilesFromFile,
  audioFilesInFolder,
  audioSelectionLabel,
  audioStatus,
  durationSummary,
  formatG,
  generateLabel,
  jobSummary,
  mergeTrackRows,
  previewStatus,
  previewTooltip,
  requirements,
  trackOptions,
  visualKind,
} from "../src/engine/video-creator";

describe("audio selection (find_audio_files)", () => {
  it("folder: direct children only, audio extensions, case-folded name order", () => {
    const entries = [
      { name: "b.MP3", relativePath: "Set/b.MP3" },
      { name: "A.wav", relativePath: "Set/A.wav" },
      { name: "cover.png", relativePath: "Set/cover.png" },
      { name: "deep.wav", relativePath: "Set/sub/deep.wav" },
      { name: "c.Flac", relativePath: "Set/c.Flac" },
      { name: "loose.aiff" },
    ];
    expect(audioFilesInFolder(entries).map((e) => e.name)).toEqual(["A.wav", "b.MP3", "c.Flac", "loose.aiff"]);
  });

  it("single file: accepted only with an audio extension", () => {
    expect(audioFilesFromFile({ name: "Track.WAVE" })).toHaveLength(1);
    expect(audioFilesFromFile({ name: "video.mp4" })).toEqual([]);
  });

  it("several picked files: audio only, case-folded name order", () => {
    const picked = [{ name: "b.MP3" }, { name: "notes.txt" }, { name: "A.wav" }];
    expect(audioFilesInFolder(picked).map((e) => e.name)).toEqual(["A.wav", "b.MP3"]);
  });

  it("selection label: the file's name, or a count for several", () => {
    expect(audioSelectionLabel(["Track.wav"])).toBe("Track.wav");
    expect(audioSelectionLabel(["b.mp3", "a.wav", "c.flac"])).toBe("3 files");
  });

  it("status and button label", () => {
    expect(audioStatus(1, true)).toBe("✓ Found 1 audio file.");
    expect(audioStatus(3, true)).toBe("✓ Found 3 audio files.");
    expect(audioStatus(0, true)).toBe("No audio files were found.");
    expect(audioStatus(0, false)).toBe("");
    expect(generateLabel(1)).toBe("Generate Video");
    expect(generateLabel(2)).toBe("Generate Videos");
  });
});

describe("visual kind", () => {
  it("routes by extension", () => {
    expect(visualKind("art.JPEG")).toBe("image");
    expect(visualKind("loop.webm")).toBe("video");
    expect(visualKind("notes.txt")).toBeNull();
  });
});

describe("track rows", () => {
  it("keep start/duration for tracks still selected, default the rest", () => {
    const previous = [
      { key: "a", name: "a.wav", start: "00:01:00", duration: 30 },
      { key: "gone", name: "gone.wav", start: "5", duration: 10 },
    ];
    expect(
      mergeTrackRows(previous, [
        { key: "a", name: "a.wav" },
        { key: "b", name: "b.wav" },
      ]),
    ).toEqual([
      { key: "a", name: "a.wav", start: "00:01:00", duration: 30 },
      { key: "b", name: "b.wav", start: "00:00:00", duration: 60 },
    ]);
  });

  it("first invalid start is reported as Track n", () => {
    const rows = [
      { key: "a", name: "a", start: "1:00", duration: 60 },
      { key: "b", name: "b", start: "1:75", duration: 60 },
    ];
    expect(trackOptions(rows)).toEqual({ options: [], error: "Track 2: Invalid timestamp: 1:75" });
    expect(trackOptions(rows.slice(0, 1)).options).toEqual([{ start: 60, duration: 60 }]);
  });
});

describe("requirements line", () => {
  const base = { trackCount: 1, visualOk: true, outputOk: true, trackError: null, running: false };

  it("ready", () => {
    expect(requirements(base)).toEqual({ ready: true, message: "✓ Ready to generate videos." });
  });

  it("lists every missing item in desktop order, trailing dots stripped", () => {
    expect(requirements({ ...base, trackCount: 0, visualOk: false, outputOk: false }).message).toBe(
      "To enable Generate: choose audio; choose a valid image or video; choose a writable export folder.",
    );
    expect(requirements({ ...base, trackError: "Track 1: Timestamp cannot be empty." }).message).toBe(
      "To enable Generate: Track 1: Timestamp cannot be empty.",
    );
  });

  it("track errors only count when audio is chosen", () => {
    expect(requirements({ ...base, trackCount: 0, trackError: "Track 1: x" }).message).toBe("To enable Generate: choose audio.");
  });

  it("running wins", () => {
    expect(requirements({ ...base, running: true })).toEqual({ ready: false, message: "Generating videos…" });
  });
});

describe("estimates", () => {
  it("duration summary", () => {
    expect(durationSummary([])).toBe("Select audio to estimate duration.");
    expect(durationSummary([{ start: 0, duration: 60 }, { start: 5, duration: 60 }])).toBe("00:01:00 per video • 00:02:00 combined");
    expect(durationSummary([{ start: 0, duration: 30 }, { start: 5, duration: 90.5 }])).toBe("00:00:30–00:01:30 per video • 00:02:00 combined");
  });

  it("job summary", () => {
    expect(jobSummary(0)).toBe("Select audio to estimate this job.");
    expect(jobSummary(3)).toBe("3 output(s)");
    expect(jobSummary(2, 5.25 * 1024 ** 3)).toBe("2 output(s) • 5.2 GB free");
  });
});

describe("preview messages", () => {
  it("formats like Python :g", () => {
    expect(formatG(60)).toBe("60");
    expect(formatG(12.5)).toBe("12.5");
    expect(formatG(3600)).toBe("3600");
    expect(formatG(100000)).toBe("100000");
  });

  it("tooltip and status", () => {
    expect(previewTooltip({ start: "", duration: 60 })).toBe("Listen from the start time for 60 seconds");
    expect(previewTooltip({ start: "1:05", duration: 12.5 })).toBe("Listen from 1:05 for 12.5 seconds");
    expect(previewStatus("a.wav", 65, 60)).toBe("Listening to a.wav from 00:01:05 for 60 seconds.");
  });
});
