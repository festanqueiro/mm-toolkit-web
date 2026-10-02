// TEMPORARY: WebKitGTK codec diagnostics for PR #11. Remove before merge.
import { test } from "@playwright/test";
test("diag: codec support matrix", async ({ page, browserName }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const out: Record<string, unknown> = {};
    const enc = async (codec: string, sampleRate: number) => {
      try { return (await AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels: 2, bitrate: 256000 })).supported; } catch (e) { return `err ${(e as Error).name}`; }
    };
    const dec = async (codec: string, sampleRate: number) => {
      try { return (await AudioDecoder.isConfigSupported({ codec, sampleRate, numberOfChannels: 2 })).supported; } catch (e) { return `err ${(e as Error).name}`; }
    };
    for (const c of ["mp3", "flac", "opus", "vorbis", "mp4a.40.2"]) {
      out[`enc ${c} 44.1k`] = await enc(c, 44100);
      out[`enc ${c} 48k`] = await enc(c, 48000);
      out[`dec ${c} 44.1k`] = await dec(c, 44100);
    }
    return out;
  });
  console.log(`DIAG ${browserName} ${JSON.stringify(result)}`);
});
