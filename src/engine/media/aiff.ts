/**
 * Minimal AIFF / AIFF-C reader for uncompressed PCM (Mediabunny has no AIFF demuxer).
 * Supports 8/16/24/32-bit big-endian integers, `sowt` little-endian 16-bit, and
 * `fl32`/`fl64` floats. Integers scale like soundfile: `x / 2^(bits−1)`.
 */

export type PcmAudio = { sampleRate: number; channels: Float32Array[] };

export class AiffError extends Error {}

const fourCC = (view: DataView, offset: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(offset + i)));

/** IEEE 754 80-bit extended (big-endian), as used for the COMM sample rate. */
function readExtended(view: DataView, offset: number): number {
  const signExp = view.getUint16(offset);
  const hi = view.getUint32(offset + 2);
  const lo = view.getUint32(offset + 6);
  const exponent = (signExp & 0x7fff) - 16383 - 63;
  const value = (hi * 2 ** 32 + lo) * 2 ** exponent;
  return signExp & 0x8000 ? -value : value;
}

export const isAiff = (bytes: ArrayBuffer) => {
  if (bytes.byteLength < 12) return false;
  const view = new DataView(bytes);
  return fourCC(view, 0) === "FORM" && ["AIFF", "AIFC"].includes(fourCC(view, 8));
};

export function decodeAiff(bytes: ArrayBuffer): PcmAudio {
  if (!isAiff(bytes)) throw new AiffError("Not an AIFF file.");
  const view = new DataView(bytes);
  const aifc = fourCC(view, 8) === "AIFC";
  let comm: { channels: number; frames: number; bits: number; rate: number; compression: string } | null = null;
  let ssnd: { offset: number; length: number } | null = null;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = fourCC(view, offset);
    const size = view.getUint32(offset + 4);
    const body = offset + 8;
    if (id === "COMM") {
      comm = {
        channels: view.getInt16(body),
        frames: view.getUint32(body + 2),
        bits: view.getInt16(body + 6),
        rate: readExtended(view, body + 8),
        compression: aifc && size >= 22 ? fourCC(view, body + 18) : "NONE",
      };
    } else if (id === "SSND") {
      const dataOffset = view.getUint32(body);
      ssnd = { offset: body + 8 + dataOffset, length: Math.min(size - 8 - dataOffset, view.byteLength - body - 8 - dataOffset) };
    }
    offset = body + size + (size % 2);
  }
  if (!comm || !ssnd) throw new AiffError("AIFF file is missing its COMM or SSND chunk.");
  const { channels: count, bits, rate } = comm;
  const compression = comm.compression.toLowerCase();
  const float = compression === "fl32" || compression === "fl64";
  const little = compression === "sowt";
  if (!["none", "sowt", "fl32", "fl64", "in24", "in32", "twos"].includes(compression)) {
    throw new AiffError(`Unsupported AIFF-C compression "${comm.compression}".`);
  }
  const bytesPer = compression === "fl64" ? 8 : compression === "fl32" ? 4 : Math.ceil(bits / 8);
  if (count < 1 || bytesPer < 1 || bytesPer > 8) throw new AiffError("Unsupported AIFF sample format.");
  const frames = Math.min(comm.frames, Math.floor(ssnd.length / (bytesPer * count)));
  const channels = Array.from({ length: count }, () => new Float32Array(frames));
  const scale = 2 ** (bytesPer * 8 - 1);
  const read = (at: number): number => {
    if (float) return bytesPer === 8 ? view.getFloat64(at) : view.getFloat32(at);
    switch (bytesPer) {
      case 1:
        return view.getInt8(at) / scale;
      case 2:
        return view.getInt16(at, little) / scale;
      case 3: {
        const v = (view.getUint8(at) << 16) | (view.getUint8(at + 1) << 8) | view.getUint8(at + 2);
        return (v & 0x800000 ? v - 0x1000000 : v) / scale;
      }
      default:
        return view.getInt32(at, little) / scale;
    }
  };
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) channels[c]![i] = read(ssnd.offset + (i * count + c) * bytesPer);
  }
  return { sampleRate: rate, channels };
}
