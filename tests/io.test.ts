import "fake-indexeddb/auto";
import { unzipSync, strFromU8 } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { uniqueZipNames, zipName, zipStream } from "../src/io/deliver";
import { fileRefFromFile, fileRefFromHandle, forgetRef, handleFor, trackIdentity } from "../src/io/file-ref";
import { clearStaging, createStagingSink, DirectorySink, stagedFile } from "../src/io/sink";
import { DB_NAME, resetDbForTests } from "../src/storage/db";
import { loadSettings, normaliseNaming, saveSetting, SETTING_DEFAULTS } from "../src/storage/settings";
import { asDir, FakeDirectoryHandle } from "./fake-fs";

const write = async (stream: WritableStream<Uint8Array>, text: string) => {
  const writer = stream.getWriter();
  await writer.write(new TextEncoder().encode(text));
  await writer.close();
};

beforeEach(async () => {
  await resetDbForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

describe("settings storage", () => {
  it("returns desktop defaults when empty", async () => {
    expect(await loadSettings()).toEqual(SETTING_DEFAULTS);
    expect(SETTING_DEFAULTS["general/promo_naming"]).toBe("{track} - Promo Snippet");
    expect(SETTING_DEFAULTS["general/clip_naming"]).toBe("{source} - {title}");
    expect(SETTING_DEFAULTS["general/conflict_policy"]).toBe("rename");
    expect(SETTING_DEFAULTS["promo/video_fade"]).toBe(false);
  });
  it("persists values across loads", async () => {
    await saveSetting("general/conflict_policy", "skip");
    await saveSetting("general/notify_finished", false);
    await resetDbForTests();
    const settings = await loadSettings();
    expect(settings["general/conflict_policy"]).toBe("skip");
    expect(settings["general/notify_finished"]).toBe(false);
  });
  it("empty naming templates fall back to defaults", () => {
    expect(normaliseNaming("general/promo_naming", "  ")).toBe("{track} - Promo Snippet");
    expect(normaliseNaming("general/clip_naming", "")).toBe("{source} - {title}");
    expect(normaliseNaming("general/clip_naming", " {title} ")).toBe("{title}");
  });
});

describe("FileRef", () => {
  it("in-session files have no handle", () => {
    const ref = fileRefFromFile(new File(["abc"], "track.wav", { lastModified: 1000 }));
    expect(ref).toMatchObject({ name: "track.wav", kind: "file", size: 3, lastModified: 1000, hasHandle: false });
    expect(trackIdentity(ref)).toBe("track.wav|3|1000");
  });
  it("persists and forgets handles", async () => {
    const dir = new FakeDirectoryHandle("Exports");
    // fake-indexeddb structured-clones values; plain fakes clone fine for this round trip.
    const ref = await fileRefFromHandle(asDir(dir));
    expect(ref).toMatchObject({ name: "Exports", kind: "directory", hasHandle: true });
    expect((await handleFor(ref))?.name).toBe("Exports");
    await forgetRef(ref);
    expect(await handleFor(ref)).toBeNull();
  });
});

describe("DirectorySink (desktop conflict policies)", () => {
  it("renames, overwrites or skips like the desktop", async () => {
    const dir = new FakeDirectoryHandle();
    const sink = new DirectorySink(asDir(dir));
    await write(await sink.create("video.mp4"), "one");
    await write(await sink.create("video (2).mp4"), "two");
    expect(await sink.resolveName("video.mp4", "rename")).toBe("video (3).mp4");
    expect(await sink.resolveName("video.mp4", "overwrite")).toBe("video.mp4");
    expect(await sink.resolveName("video.mp4", "skip")).toBeNull();
    expect(await sink.resolveName("new.mp4", "skip")).toBe("new.mp4");
  });
  it("treats a same-named folder as existing", async () => {
    const dir = new FakeDirectoryHandle();
    await dir.getDirectoryHandle("clip.wav", { create: true });
    expect(await new DirectorySink(asDir(dir)).exists("clip.wav")).toBe(true);
  });
  it("removes partial outputs and tolerates missing ones", async () => {
    const dir = new FakeDirectoryHandle();
    const sink = new DirectorySink(asDir(dir));
    await write(await sink.create("partial.mp4"), "x");
    await sink.remove("partial.mp4");
    await sink.remove("never-existed.mp4");
    expect(await sink.exists("partial.mp4")).toBe(false);
  });
  it("completes with size", async () => {
    const sink = new DirectorySink(asDir(new FakeDirectoryHandle()));
    await write(await sink.create("a.txt"), "hello");
    expect(await sink.complete("a.txt")).toEqual({ name: "a.txt", sink: "directory", size: 5 });
  });
});

describe("staging + ZIP delivery", () => {
  it("stages outputs in OPFS per job and cleans up", async () => {
    const root = new FakeDirectoryHandle("opfs");
    const sink = await createStagingSink("job-1", asDir(root));
    await write(await sink.create("Song - Promo Snippet.mp4"), "video");
    const ref = await sink.complete("Song - Promo Snippet.mp4");
    expect(ref.opfsPath).toEqual(["exports", "job-1", "Song - Promo Snippet.mp4"]);
    expect(await (await stagedFile(ref, asDir(root))).text()).toBe("video");
    await clearStaging("job-1", asDir(root));
    await expect(stagedFile(ref, asDir(root))).rejects.toThrow();
  });
  it("renames duplicate names inside a ZIP", async () => {
    expect(await uniqueZipNames(["a.wav", "a.wav", "b.wav", "a.wav"])).toEqual(["a.wav", "a (2).wav", "b.wav", "a (3).wav"]);
  });
  it("builds a valid ZIP", async () => {
    const files = [new File(["one"], "clip.wav"), new File(["two"], "clip.wav")];
    const bytes = new Uint8Array(await new Response(await zipStream(files)).arrayBuffer());
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).sort()).toEqual(["clip (2).wav", "clip.wav"]);
    expect(strFromU8(entries["clip (2).wav"]!)).toBe("two");
  });
  it("names ZIPs by tool and local time", () => {
    expect(zipName("Media Cutter", new Date(2026, 9, 2, 9, 5))).toBe("Media Cutter export 2026-10-02 09-05.zip");
  });
});
