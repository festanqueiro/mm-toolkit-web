import { describe, expect, it } from "vitest";
import {
  AUDIO_EXTENSIONS,
  AUDIO_OUTPUT_FORMATS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  VIDEO_OUTPUT_FORMATS,
  mediaKind,
} from "../src/engine/media-kind";
import { resolveOutput, safeFilename, type ConflictPolicy } from "../src/engine/naming";
import { pyRound } from "../src/engine/py";
import { formatTimestamp, parseTimestamp } from "../src/engine/time";
import { isNewerVersion, versionTuple } from "../src/engine/version";
import { golden } from "./golden";

const { pure } = golden;

describe("parseTimestamp (golden)", () => {
  it.each(pure.parseTimestamp)("$input", ({ input, seconds, error }) => {
    if (error !== undefined) expect(() => parseTimestamp(input)).toThrow(error);
    else expect(parseTimestamp(input)).toBe(seconds);
  });
});

describe("formatTimestamp (golden, banker's rounding)", () => {
  it.each(pure.formatTimestamp)("$seconds → $text", ({ seconds, text }) => {
    expect(formatTimestamp(seconds)).toBe(text);
  });
});

describe("pyRound", () => {
  it("rounds half to even like Python", () => {
    expect([0.5, 1.5, 2.5, -0.5, -1.5, 2.4, 2.6].map(pyRound)).toEqual([0, 2, 2, 0, -2, 2, 3]);
  });
});

describe("safeFilename (golden)", () => {
  it.each(pure.safeFilename)("$input", ({ input, output }) => {
    expect(safeFilename(input)).toBe(output);
  });
});

describe("resolveOutput (golden)", () => {
  const existing = new Set(pure.resolveOutput.existingFiles);
  it.each(Object.entries(pure.resolveOutput.results))("%s", async (policy, expected) => {
    const result = await resolveOutput(pure.resolveOutput.requested, policy as ConflictPolicy, (n) => existing.has(n));
    expect(result).toBe(expected);
  });
  it("returns the requested name when nothing exists", async () => {
    expect(await resolveOutput("new.mp4", "skip", () => false)).toBe("new.mp4");
  });
  it("rejects unknown policies", async () => {
    await expect(resolveOutput("a.mp4", "nope" as ConflictPolicy, () => true)).rejects.toThrow(
      "Unknown conflict policy: nope",
    );
  });
});

describe("media kind & extension tables (golden)", () => {
  it.each(Object.entries(pure.mediaKind))("%s", (name, kind) => {
    expect(mediaKind(name)).toBe(kind);
  });
  it("matches the desktop extension and format lists", () => {
    expect([...AUDIO_EXTENSIONS]).toEqual(pure.audioExtensions);
    expect([...IMAGE_EXTENSIONS]).toEqual(pure.imageExtensions);
    expect([...VIDEO_EXTENSIONS]).toEqual(pure.videoExtensions);
    expect([...AUDIO_OUTPUT_FORMATS]).toEqual(pure.audioOutputFormats);
    expect([...VIDEO_OUTPUT_FORMATS]).toEqual(pure.videoOutputFormats);
  });
});

describe("versioning (golden)", () => {
  it.each(Object.entries(pure.versionTuple))("versionTuple(%j)", (input, expected) => {
    expect(versionTuple(input)).toEqual(expected);
  });
  it.each(pure.isNewerVersion)("$candidate newer than $current: $newer", ({ current, candidate, newer }) => {
    expect(isNewerVersion(current, candidate)).toBe(newer);
  });
  it("package version is semver", () => {
    expect(versionTuple(__APP_VERSION__)).not.toBeNull();
  });
});
