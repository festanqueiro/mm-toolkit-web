import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { fileRefFromHandle } from "../src/io/file-ref";
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

  it("export-folder outputs open from the chosen folder", async () => {
    const folder = new FakeDirectoryHandle("Exports");
    const writer = (await (await folder.getFileHandle("song.mp3", { create: true })).createWritable()).getWriter();
    await writer.write(new Uint8Array(5));
    await writer.close();
    const ref = await fileRefFromHandle(asDir(folder));
    const output = { name: "song.mp3", sink: "directory" as const };
    const results = await jobResults([output], { output: ref, outputs: [output] });
    expect(results.map((r) => r.name)).toEqual(["song.mp3"]);
    expect((await results[0]!.open()).size).toBe(5);
  });

  it("an output that can't be found is still listed, and won't open", async () => {
    const folder = new FakeDirectoryHandle("Exports");
    const ref = await fileRefFromHandle(asDir(folder));
    const output = { name: "gone.mp3", sink: "directory" as const };
    const results = await jobResults([output], { output: ref, outputs: [output] });
    expect(results.map((r) => r.name)).toEqual(["gone.mp3"]);
    await expect(results[0]!.open()).rejects.toThrow();
  });

  it("a failed lookup lists every output as unavailable", async () => {
    const output = { name: "a.mp3", sink: "directory" as const };
    const results = await jobResults([output], { output: "not a ref", outputs: null as unknown as [] });
    expect(results.map((r) => r.name)).toEqual(["a.mp3"]);
    await expect(results[0]!.open()).rejects.toThrow();
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
