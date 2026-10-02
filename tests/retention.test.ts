import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { resolveOutputs } from "../src/io/history-outputs";
import { keptBytes, prepareStaging } from "../src/io/retention";
import { createStagingSink, stagingUsage } from "../src/io/sink";
import { asDir, FakeDirectoryHandle } from "./fake-fs";

async function stage(root: FakeDirectoryHandle, job: string, name: string, bytes: number) {
  const sink = await createStagingSink(job, asDir(root));
  const writer = (await sink.create(name)).getWriter();
  await writer.write(new Uint8Array(bytes));
  await writer.close();
  return sink.complete(name);
}

describe("staged-output retention", () => {
  it("off: clears every job except the running one", async () => {
    const root = new FakeDirectoryHandle();
    await stage(root, "001", "a.mp4", 10);
    await stage(root, "002", "b.mp4", 10);
    await prepareStaging(false, ["002"], 0, asDir(root));
    expect((await stagingUsage(asDir(root))).map((j) => j.id)).toEqual(["002"]);
  });

  it("on: keeps copies, evicting the oldest beyond the cap", async () => {
    const root = new FakeDirectoryHandle();
    await stage(root, "001", "a.mp4", 40);
    await stage(root, "002", "b.mp4", 30);
    await stage(root, "003", "c.mp4", 50);
    await prepareStaging(true, [], 100, asDir(root));
    expect((await stagingUsage(asDir(root))).map((j) => j.id).sort()).toEqual(["002", "003"]);
    expect(await keptBytes(asDir(root))).toBe(80);
  });
});

describe("resolveOutputs", () => {
  it("lists kept copies and drops evicted or in-memory ones", async () => {
    const root = new FakeDirectoryHandle();
    const kept = await stage(root, "001", "a.mp4", 5);
    const evicted = { name: "gone.mp4", sink: "staged" as const, opfsPath: ["exports", "999", "gone.mp4"] };
    const memory = { name: "mem.mp4", sink: "memory" as const };
    const { files, folder } = await resolveOutputs({ output: { name: "Downloads" }, outputs: [kept, evicted, memory] }, asDir(root));
    expect(folder).toBeNull();
    expect(files.map((f) => [f.name, f.staged])).toEqual([["a.mp4", true]]);
    expect((await files[0]!.open()).size).toBe(5);
  });
});
