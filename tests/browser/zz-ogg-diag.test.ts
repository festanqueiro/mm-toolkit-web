// TEMPORARY: WebKitGTK Ogg diagnostics for PR #11. Remove before merge.
import { it } from "vitest";
import { ALL_FORMATS, AudioSample, AudioSampleSink, AudioSampleSource, BlobSource, BufferTarget, Input, OggOutputFormat, Output } from "mediabunny";
import oggUrl from "../../fixtures/media/tone-4s.ogg?url";

const within = <T>(ms: number, p: Promise<T>) => Promise.race([p, new Promise<string>((r) => setTimeout(() => r(`TIMEOUT ${ms}ms`), ms))]);

it("diag: vorbis decode and opus encode", async () => {
  const log: Record<string, unknown> = { ua: navigator.userAgent };
  const input = new Input({ source: new BlobSource(await (await fetch(oggUrl)).blob()), formats: ALL_FORMATS });
  const track = (await input.getPrimaryAudioTrack())!;
  log.codec = track.codec;
  log.canDecode = await track.canDecode();
  log.decode = await within(8000, (async () => {
    let frames = 0;
    for await (const s of new AudioSampleSink(track).samples()) { frames += s.numberOfFrames; s.close(); }
    return frames;
  })().catch((e) => `ERR ${e}`));
  for (const rate of [44100, 48000]) {
    log[`opus@${rate}`] = await within(8000, (async () => {
      const out = new Output({ format: new OggOutputFormat(), target: new BufferTarget() });
      const src = new AudioSampleSource({ codec: "opus", bitrate: 256000 });
      out.addAudioTrack(src);
      await out.start();
      const data = new Float32Array(rate * 2 * 2).map((_, i) => Math.sin(i / 10) * 0.3);
      const sample = new AudioSample({ data, format: "f32-planar", numberOfChannels: 2, sampleRate: rate, timestamp: 0 });
      await src.add(sample); sample.close(); src.close();
      await out.finalize();
      return out.target.buffer!.byteLength;
    })().catch((e) => `ERR ${e}`));
  }
  console.log(`OGGDIAG ${JSON.stringify(log)}`);
}, 40000);
