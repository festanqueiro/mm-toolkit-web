/** Minimal 16-bit PCM WAV reader for tests; scales like soundfile (int16 / 32768). */
import { readFileSync } from "node:fs";

export type Pcm = { sampleRate: number; channels: Float64Array[] };

export function readWav16(path: string | URL): Pcm {
  const buffer = readFileSync(path);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 12;
  let sampleRate = 0;
  let channelCount = 0;
  while (offset + 8 <= view.byteLength) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      if (view.getUint16(offset + 8, true) !== 1 || view.getUint16(offset + 22, true) !== 16) throw new Error("Expected 16-bit PCM");
      channelCount = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
    } else if (id === "data") {
      const frames = size / (2 * channelCount);
      const channels = Array.from({ length: channelCount }, () => new Float64Array(frames));
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channelCount; c++) channels[c]![i] = view.getInt16(offset + 8 + (i * channelCount + c) * 2, true) / 32768;
      }
      return { sampleRate, channels };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("No data chunk");
}
