import { describe, expect, it } from "vitest";
import { frameCountFor, promoOutputName } from "../src/engine/render/promo";
import { MemorySink } from "../src/io/sink";

describe("promo naming (generate_videos)", () => {
  it("formats {track} and 1-based {number}, then safe-filenames", () => {
    expect(promoOutputName("{track} - Promo Snippet", "My: Song.wav", 0)).toBe("My- Song - Promo Snippet.mp4");
    expect(promoOutputName("{number:02d} {track}", "b.flac", 2)).toBe("03 b.mp4");
  });

  it("an invalid template fails with the desktop message", () => {
    expect(() => promoOutputName("{title}", "a.wav", 0)).toThrow("Invalid promo naming template. Use {track} and optionally {number}.");
  });
});

describe("frame count (moviepy np.arange(0, duration, 1/fps))", () => {
  it.each([
    [60, 24, 1440],
    [2, 24, 48],
    [1.5, 24, 36],
    [10.01, 24, 241],
    [0.01, 24, 1],
  ])("%s s at %s fps → %s frames", (duration, fps, frames) => {
    expect(frameCountFor(duration, fps)).toBe(frames);
  });
});

describe("MemorySink", () => {
  it("writes, renames on conflict, completes with the file, removes", async () => {
    const sink = new MemorySink();
    const writer = (await sink.create("a.mp4")).getWriter();
    await writer.write(Uint8Array.from([1, 2, 3]));
    await writer.close();
    expect(await sink.resolveName("a.mp4", "rename")).toBe("a (2).mp4");
    expect(await sink.resolveName("a.mp4", "skip")).toBeNull();
    const ref = await sink.complete("a.mp4");
    expect(ref).toMatchObject({ name: "a.mp4", sink: "memory", size: 3 });
    expect([...new Uint8Array(await ref.file!.arrayBuffer())]).toEqual([1, 2, 3]);
    await sink.remove("a.mp4");
    expect(await sink.exists("a.mp4")).toBe(false);
  });
});
