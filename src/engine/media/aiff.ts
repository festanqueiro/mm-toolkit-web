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

/** Where the samples live and how they're encoded. `dataOffset` is absolute in the file. */
export type AiffLayout = {
  channels: number;
  frames: number;
  sampleRate: number;
  bytesPer: number;
  float: boolean;
  little: boolean;
  dataOffset: number;
};

function commLayout(view: DataView, body: number, size: number, aifc: boolean) {
  const compressionId = aifc && size >= 22 ? fourCC(view, body + 18) : "NONE";
  const compression = compressionId.toLowerCase();
  if (!["none", "sowt", "fl32", "fl64", "in24", "in32", "twos"].includes(compression)) {
    throw new AiffError(`Unsupported AIFF-C compression "${compressionId}".`);
  }
  const channels = view.getInt16(body);
  const bits = view.getInt16(body + 6);
  const bytesPer = compression === "fl64" ? 8 : compression === "fl32" ? 4 : Math.ceil(bits / 8);
  if (channels < 1 || bytesPer < 1 || bytesPer > 8) throw new AiffError("Unsupported AIFF sample format.");
  return {
    channels,
    frames: view.getUint32(body + 2),
    sampleRate: readExtended(view, body + 8),
    bytesPer,
    float: compression === "fl32" || compression === "fl64",
    little: compression === "sowt",
  };
}

/**
 * Find COMM and SSND by reading chunk headers only, so a long file is never loaded whole.
 * `read(offset, length)` returns those bytes of the file.
 */
export async function readAiffLayout(read: (offset: number, length: number) => Promise<ArrayBuffer>, size: number): Promise<AiffLayout> {
  if (!isAiff(await read(0, 12))) throw new AiffError("Not an AIFF file.");
  const aifc = fourCC(new DataView(await read(8, 4)), 0) === "AIFC";
  let comm: ReturnType<typeof commLayout> | null = null;
  let ssnd: { offset: number; length: number } | null = null;
  let offset = 12;
  while (offset + 8 <= size && !(comm && ssnd)) {
    const header = new DataView(await read(offset, 8));
    const id = fourCC(header, 0);
    const chunkSize = header.getUint32(4);
    const body = offset + 8;
    if (id === "COMM") comm = commLayout(new DataView(await read(body, Math.min(chunkSize, 64))), 0, chunkSize, aifc);
    else if (id === "SSND") {
      const dataOffset = new DataView(await read(body, 4)).getUint32(0);
      ssnd = { offset: body + 8 + dataOffset, length: Math.min(chunkSize - 8 - dataOffset, size - body - 8 - dataOffset) };
    }
    offset = body + chunkSize + (chunkSize % 2);
  }
  if (!comm || !ssnd) throw new AiffError("AIFF file is missing its COMM or SSND chunk.");
  return { ...comm, frames: Math.max(0, Math.min(comm.frames, Math.floor(ssnd.length / (comm.bytesPer * comm.channels)))), dataOffset: ssnd.offset };
}

/** Decode `count` frames from `bytes`, which start at frame `0` of the span to decode. */
export function decodeAiffFrames(bytes: ArrayBuffer, layout: AiffLayout, count: number): Float32Array[] {
  const view = new DataView(bytes);
  const { channels: n, bytesPer, float, little } = layout;
  const frames = Math.min(count, Math.floor(bytes.byteLength / (bytesPer * n)));
  const channels = Array.from({ length: n }, () => new Float32Array(frames));
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
    for (let c = 0; c < n; c++) channels[c]![i] = read((i * n + c) * bytesPer);
  }
  return channels;
}

export const blobReader = (blob: Blob) => (offset: number, length: number) => blob.slice(offset, offset + length).arrayBuffer();

/** Decode a whole AIFF held in memory. */
export function decodeAiff(bytes: ArrayBuffer): PcmAudio {
  const layout = readAiffLayoutSync(bytes);
  const span = bytes.slice(layout.dataOffset, layout.dataOffset + layout.frames * layout.bytesPer * layout.channels);
  return { sampleRate: layout.sampleRate, channels: decodeAiffFrames(span, layout, layout.frames) };
}

function readAiffLayoutSync(bytes: ArrayBuffer): AiffLayout {
  if (!isAiff(bytes)) throw new AiffError("Not an AIFF file.");
  const view = new DataView(bytes);
  const aifc = fourCC(view, 8) === "AIFC";
  let comm: ReturnType<typeof commLayout> | null = null;
  let ssnd: { offset: number; length: number } | null = null;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = fourCC(view, offset);
    const size = view.getUint32(offset + 4);
    const body = offset + 8;
    if (id === "COMM") comm = commLayout(view, body, size, aifc);
    else if (id === "SSND") {
      const dataOffset = view.getUint32(body);
      ssnd = { offset: body + 8 + dataOffset, length: Math.min(size - 8 - dataOffset, view.byteLength - body - 8 - dataOffset) };
    }
    offset = body + size + (size % 2);
  }
  if (!comm || !ssnd) throw new AiffError("AIFF file is missing its COMM or SSND chunk.");
  return { ...comm, frames: Math.max(0, Math.min(comm.frames, Math.floor(ssnd.length / (comm.bytesPer * comm.channels)))), dataOffset: ssnd.offset };
}

/**
 * Decode `[start, start + duration)` (or everything) of an AIFF Blob, reading only the
 * header chunks and that span's bytes.
 */
export async function decodeAiffBlob(blob: Blob, range?: { start: number; duration: number }): Promise<PcmAudio> {
  const layout = await readAiffLayout(blobReader(blob), blob.size);
  const from = range ? Math.min(layout.frames, Math.max(0, Math.round(range.start * layout.sampleRate))) : 0;
  const to = range ? Math.min(layout.frames, Math.max(from, Math.round((range.start + range.duration) * layout.sampleRate))) : layout.frames;
  const frameBytes = layout.bytesPer * layout.channels;
  const span = await blob.slice(layout.dataOffset + from * frameBytes, layout.dataOffset + to * frameBytes).arrayBuffer();
  return { sampleRate: layout.sampleRate, channels: decodeAiffFrames(span, layout, to - from) };
}

/** IEEE 754 80-bit extended (big-endian) for a positive integer-ish sample rate. */
function writeExtended(view: DataView, offset: number, value: number): void {
  if (!(value > 0)) {
    for (let i = 0; i < 10; i++) view.setUint8(offset + i, 0);
    return;
  }
  const exponent = Math.floor(Math.log2(value));
  const mantissa = value / 2 ** exponent; // in [1, 2)
  const hi = Math.floor(mantissa * 2 ** 31);
  const lo = Math.round((mantissa * 2 ** 31 - hi) * 2 ** 32);
  view.setUint16(offset, exponent + 16383);
  view.setUint32(offset + 2, hi);
  view.setUint32(offset + 6, lo);
}

/**
 * Plain AIFF, 24-bit big-endian PCM (FFmpeg `pcm_s24be`). Floats scale by 2^23 and clip,
 * so 16- and 24-bit sources round-trip exactly.
 */
export function encodeAiff24(pcm: PcmAudio): Uint8Array {
  const count = pcm.channels.length;
  const frames = pcm.channels[0]?.length ?? 0;
  const dataBytes = frames * count * 3;
  const pad = dataBytes % 2;
  const total = 12 + 26 + 16 + dataBytes + pad;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  ascii(0, "FORM");
  view.setUint32(4, total - 8);
  ascii(8, "AIFF");
  ascii(12, "COMM");
  view.setUint32(16, 18);
  view.setInt16(20, count);
  view.setUint32(22, frames);
  view.setInt16(26, 24);
  writeExtended(view, 28, pcm.sampleRate);
  ascii(38, "SSND");
  view.setUint32(42, 8 + dataBytes);
  view.setUint32(46, 0);
  view.setUint32(50, 0);
  let at = 54;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const v = Math.round(pcm.channels[c]![i]! * 8388608);
      const s = v > 8388607 ? 8388607 : v < -8388608 ? -8388608 : v;
      bytes[at++] = (s >> 16) & 0xff;
      bytes[at++] = (s >> 8) & 0xff;
      bytes[at++] = s & 0xff;
    }
  }
  return bytes;
}
