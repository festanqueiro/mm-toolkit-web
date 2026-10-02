import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createStagingSink } from "../src/io/sink";
import { jobResults, savedToLabel } from "../src/ui/job-results";
import { asDir, FakeDirectoryHandle } from "./fake-fs";

describe("jobResults", () => {
  it("in-memory outputs are returned directly, in order", async () => {
    const a = new File(["a"], "a.wav");
    const b = new File(["bb"], "b.wav");
    const results = await jobResults(
      [
        { name: "a.wav", sink: "memory", file: a },
        { name: "b.wav", sink: "memory", file: b },
      ],
      { outputs: [] },
    );
    expect(results.map((r) => r.name)).toEqual(["a.wav", "b.wav"]);
    expect(await results[1]!.open()).toBe(b);
  });

  it("staged outputs resolve through OPFS", async () => {
    const root = new FakeDirectoryHandle();
    const sink = await createStagingSink("job-1", asDir(root));
    const writer = (await sink.create("x.mp3")).getWriter();
    await writer.write(new Uint8Array(3));
    await writer.close();
    const ref = await sink.complete("x.mp3");
    const results = await jobResults([ref], { output: { name: "Downloads" }, outputs: [ref] }, asDir(root));
    expect(results.map((r) => r.name)).toEqual(["x.mp3"]);
    expect((await results[0]!.open()).size).toBe(3);
  });

  it("no outputs → no results", async () => {
    expect(await jobResults([], { outputs: [] })).toEqual([]);
  });
});

describe("savedToLabel", () => {
  it("folder or Downloads", () => {
    expect(savedToLabel(true, "Exports")).toBe("Saved to Exports");
    expect(savedToLabel(true, undefined)).toBe("Saved to your export folder");
    expect(savedToLabel(false, "Exports")).toBe("Downloaded");
  });
});
