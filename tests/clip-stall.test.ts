import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { CustomAudioDecoder, registerDecoder, type AudioCodec } from "mediabunny";
import { setDecodeStallMs } from "../src/engine/media/audio-decode";
import { cutClipsJob, UndecodableAudioError } from "../src/engine/render/clips";
import { MemorySink } from "../src/io/sink";

/** Claims AAC and never produces a sample, like WebKitGTK's GStreamer Vorbis decoder. */
class HangingDecoder extends CustomAudioDecoder {
  static override supports(codec: AudioCodec) {
    return codec === "aac";
  }
  init() {}
  decode() {}
  flush() {
    return new Promise<void>(() => {});
  }
  close() {}
}

registerDecoder(HangingDecoder);
setDecodeStallMs(300);
afterAll(() => setDecodeStallMs(15_000));

it("a hung decoder trips the stall watchdog and asks the page to decode", async () => {
  const source = new File([readFileSync(new URL("../fixtures/media/tone-4s.m4a", import.meta.url))], "tone-4s.m4a");
  const sink = new MemorySink();
  const error = await cutClipsJob({ source, clips: [{ title: "", start: 0, duration: 1 }], naming: "{title}", conflict: "rename" }, sink, {
    progress: () => {},
    warn: () => {},
    cancelled: () => false,
  }).catch((e) => e);
  expect(error).toBeInstanceOf(UndecodableAudioError);
  expect(error).toMatchObject({ sampleRate: 44_100, numberOfChannels: 2 });
  expect(await sink.exists("Clip 01.m4a")).toBe(false);
}, 20_000);

it("cancel doesn't wait on a hung decoder", async () => {
  const source = new File([readFileSync(new URL("../fixtures/media/tone-4s.m4a", import.meta.url))], "tone-4s.m4a");
  setDecodeStallMs(60_000);
  let cancel = false;
  setTimeout(() => (cancel = true), 200);
  const error = await cutClipsJob({ source, clips: [{ title: "", start: 0, duration: 1 }], naming: "{title}", conflict: "rename" }, new MemorySink(), {
    progress: () => {},
    warn: () => {},
    cancelled: () => cancel,
  }).catch((e) => e);
  expect(error?.constructor?.name).toBe("CancelledError");
}, 10_000);
