import { describe, expect, it } from "vitest";
import { downloadingModel, finishedStems, orderStems, separating, stemOutputName, stemRequirements, stemsStatus } from "../src/engine/stems/rules";

describe("Stem Splitter rules", () => {
  it("names", () => {
    expect(stemOutputName("My Song.final.flac", "vocals", "wav")).toBe("My Song.final - Vocals.wav");
    expect(stemOutputName("track", "instrumental", "mp3")).toBe("track - Instrumental.mp3");
  });
  it("stem order and status", () => {
    expect(orderStems(["instrumental", "drums", "vocals"])).toEqual(["vocals", "drums", "instrumental"]);
    expect(stemsStatus(0)).toBe("Choose at least one stem.");
    expect(stemsStatus(1)).toBe("✓ 1 stem selected.");
    expect(stemsStatus(2)).toBe("✓ 2 stems selected.");
  });
  it("requirements", () => {
    expect(stemRequirements({ sourceOk: false, stems: 0, outputOk: false, running: false }).message).toBe(
      "To enable Split Stems: choose a source; choose at least one stem; choose a writable export folder.",
    );
    expect(stemRequirements({ sourceOk: true, stems: 2, outputOk: true, running: false })).toEqual({ ready: true, message: "✓ Ready to split stems." });
    expect(stemRequirements({ sourceOk: true, stems: 2, outputOk: true, running: true }).message).toBe("Splitting stems…");
  });
  it("progress", () => {
    expect(downloadingModel(0.4567)).toBe("Downloading model… 45%");
    expect(separating("a.wav", 0, 7)).toBe("Separating a.wav (1 of 7)");
    expect(finishedStems(1)).toBe("Finished 1 stem");
  });
});
