/**
 * A small pure-TS FLAC frame decoder, registered as Mediabunny's FLAC decoder. WebKit
 * reports WebCodecs FLAC decoding as supported but fails at runtime ("InternalAudioDecoderCocoa
 * decoding failed"), and capability detection can't see that in advance; decoding in TS
 * also makes FLAC bit-exact and identical in every engine. Mediabunny's demuxer hands us one
 * FLAC frame per packet.
 */
import { AudioSample, CustomAudioDecoder, registerDecoder, type AudioCodec, type EncodedPacket } from "mediabunny";

export class FlacError extends Error {}

class BitReader {
  private pos = 0; // in bits
  constructor(private readonly bytes: Uint8Array) {}

  get bytePos(): number {
    return this.pos >> 3;
  }

  /** Unsigned read of up to 32 bits. */
  bits(n: number): number {
    let value = 0;
    for (let i = 0; i < n; ) {
      const byte = this.bytes[this.pos >> 3];
      if (byte === undefined) throw new FlacError("Truncated FLAC frame.");
      const offset = this.pos & 7;
      const take = Math.min(8 - offset, n - i);
      const chunk = (byte >> (8 - offset - take)) & ((1 << take) - 1);
      value = value * (1 << take) + chunk;
      this.pos += take;
      i += take;
    }
    return value;
  }

  signed(n: number): number {
    if (n === 0) return 0;
    const value = this.bits(n);
    return value >= 2 ** (n - 1) ? value - 2 ** n : value;
  }

  /** Count zero bits up to (and consuming) the next one bit. */
  unary(): number {
    let count = 0;
    for (;;) {
      const byte = this.bytes[this.pos >> 3];
      if (byte === undefined) throw new FlacError("Truncated FLAC frame.");
      const offset = this.pos & 7;
      const rest = (byte << offset) & 0xff;
      if (rest === 0) {
        count += 8 - offset;
        this.pos += 8 - offset;
        continue;
      }
      const lead = Math.clz32(rest) - 24;
      count += lead;
      this.pos += lead + 1;
      return count;
    }
  }

  align(): void {
    this.pos = (this.pos + 7) & ~7;
  }
}

export type FlacStreamInfo = { sampleRate: number; channels: number; bitsPerSample: number };

/** STREAMINFO from a decoder description (`fLaC` + header + STREAMINFO, header + STREAMINFO, or bare). */
export function parseStreamInfo(description: AllowSharedBufferSource | undefined): FlacStreamInfo | null {
  if (!description) return null;
  const bytes = ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description);
  const magic = bytes.length >= 4 && String.fromCharCode(...bytes.subarray(0, 4)) === "fLaC";
  const offset = magic ? 8 : bytes.length === 34 ? 0 : 4;
  if (bytes.length < offset + 18) return null;
  const b = bytes.subarray(offset);
  return {
    sampleRate: (b[10]! << 12) | (b[11]! << 4) | (b[12]! >> 4),
    channels: ((b[12]! >> 1) & 7) + 1,
    bitsPerSample: (((b[12]! & 1) << 4) | (b[13]! >> 4)) + 1,
  };
}

export type FlacFrame = { sampleRate: number; bitsPerSample: number; channels: Int32Array[] };

const BLOCK_SIZES = [0, 192, 576, 1152, 2304, 4608, 0, 0, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];
const SAMPLE_RATES = [0, 88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000];
const SAMPLE_SIZES = [0, 8, 12, 0, 16, 20, 24, 32];

/** Decode one FLAC frame (header, subframes, stereo decorrelation). CRCs are not verified. */
export function decodeFlacFrame(bytes: Uint8Array, info: FlacStreamInfo | null): FlacFrame {
  const r = new BitReader(bytes);
  if (r.bits(14) !== 0x3ffe) throw new FlacError("Missing FLAC frame sync code.");
  r.bits(2); // reserved, blocking strategy
  const blockCode = r.bits(4);
  const rateCode = r.bits(4);
  const assignment = r.bits(4);
  const sizeCode = r.bits(3);
  r.bits(1);
  // UTF-8-style coded frame/sample number.
  const first = r.bits(8);
  for (let extra = first >= 0xc0 ? Math.clz32(~(first << 24)) - 1 : 0; extra > 0; extra--) r.bits(8);
  let blockSize = BLOCK_SIZES[blockCode]!;
  if (blockCode === 6) blockSize = r.bits(8) + 1;
  else if (blockCode === 7) blockSize = r.bits(16) + 1;
  let sampleRate = SAMPLE_RATES[rateCode] ?? 0;
  if (rateCode === 0) sampleRate = info?.sampleRate ?? 0;
  else if (rateCode === 12) sampleRate = r.bits(8) * 1000;
  else if (rateCode === 13) sampleRate = r.bits(16);
  else if (rateCode === 14) sampleRate = r.bits(16) * 10;
  const bitsPerSample = sizeCode === 0 ? (info?.bitsPerSample ?? 0) : SAMPLE_SIZES[sizeCode]!;
  r.bits(8); // CRC-8
  if (!blockSize || !sampleRate || !bitsPerSample || assignment > 10) throw new FlacError("Unsupported FLAC frame header.");

  const count = assignment < 8 ? assignment + 1 : 2;
  const channels: Int32Array[] = [];
  for (let c = 0; c < count; c++) {
    // The side channel carries one extra bit.
    const side = (assignment === 8 && c === 1) || (assignment === 9 && c === 0) || (assignment === 10 && c === 1);
    channels.push(decodeSubframe(r, blockSize, bitsPerSample + (side ? 1 : 0)));
  }
  r.align();

  if (assignment >= 8) {
    const [a, b] = channels as [Int32Array, Int32Array];
    for (let i = 0; i < blockSize; i++) {
      if (assignment === 8) b[i] = a[i]! - b[i]!; // left/side → right
      else if (assignment === 9) a[i] = a[i]! + b[i]!; // side/right → left
      else {
        const side = b[i]!;
        const mid = a[i]! * 2 + (side & 1);
        a[i] = (mid + side) >> 1;
        b[i] = (mid - side) >> 1;
      }
    }
  }
  return { sampleRate, bitsPerSample, channels };
}

function decodeSubframe(r: BitReader, blockSize: number, bps: number): Int32Array {
  if (r.bits(1) !== 0) throw new FlacError("Bad FLAC subframe padding.");
  const type = r.bits(6);
  let wasted = 0;
  if (r.bits(1)) wasted = r.unary() + 1;
  const bits = bps - wasted;
  const out = new Int32Array(blockSize);
  if (type === 0) {
    out.fill(r.signed(bits));
  } else if (type === 1) {
    for (let i = 0; i < blockSize; i++) out[i] = r.signed(bits);
  } else if (type >= 8 && type <= 12) {
    const order = type & 7;
    for (let i = 0; i < order; i++) out[i] = r.signed(bits);
    residual(r, out, order, blockSize);
    fixedPredict(out, order);
  } else if (type >= 32) {
    const order = (type & 31) + 1;
    for (let i = 0; i < order; i++) out[i] = r.signed(bits);
    const precision = r.bits(4) + 1;
    const shift = r.signed(5);
    const coefs = Array.from({ length: order }, () => r.signed(precision));
    residual(r, out, order, blockSize);
    for (let i = order; i < blockSize; i++) {
      let sum = 0;
      for (let j = 0; j < order; j++) sum += coefs[j]! * out[i - 1 - j]!;
      out[i] = out[i]! + Math.floor(sum / 2 ** shift);
    }
  } else {
    throw new FlacError(`Reserved FLAC subframe type ${type}.`);
  }
  if (wasted) for (let i = 0; i < blockSize; i++) out[i] = out[i]! << wasted;
  return out;
}

/** Rice-coded residual into `out[order..]` (prediction is added afterwards). */
function residual(r: BitReader, out: Int32Array, order: number, blockSize: number): void {
  const method = r.bits(2);
  if (method > 1) throw new FlacError("Reserved FLAC residual coding method.");
  const paramBits = method === 0 ? 4 : 5;
  const escape = method === 0 ? 15 : 31;
  const partitionOrder = r.bits(4);
  const partitions = 1 << partitionOrder;
  let i = order;
  for (let p = 0; p < partitions; p++) {
    const count = (blockSize >> partitionOrder) - (p === 0 ? order : 0);
    const k = r.bits(paramBits);
    if (k === escape) {
      const raw = r.bits(5);
      for (let n = 0; n < count; n++) out[i++] = r.signed(raw);
      continue;
    }
    for (let n = 0; n < count; n++) {
      const v = r.unary() * 2 ** k + r.bits(k);
      out[i++] = v % 2 === 0 ? v / 2 : -(v + 1) / 2;
    }
  }
}

function fixedPredict(s: Int32Array, order: number): void {
  for (let i = order; i < s.length; i++) {
    switch (order) {
      case 1:
        s[i] = s[i]! + s[i - 1]!;
        break;
      case 2:
        s[i] = s[i]! + 2 * s[i - 1]! - s[i - 2]!;
        break;
      case 3:
        s[i] = s[i]! + 3 * s[i - 1]! - 3 * s[i - 2]! + s[i - 3]!;
        break;
      case 4:
        s[i] = s[i]! + 4 * s[i - 1]! - 6 * s[i - 2]! + 4 * s[i - 3]! - s[i - 4]!;
        break;
    }
  }
}

/** Planar audio for Mediabunny: s16 for ≤16-bit streams (exact), s32 (left-aligned) otherwise. */
function toSample(frame: FlacFrame, timestamp: number): AudioSample {
  const n = frame.channels[0]!.length;
  const common = { numberOfChannels: frame.channels.length, sampleRate: frame.sampleRate, timestamp };
  if (frame.bitsPerSample <= 16) {
    const data = new Int16Array(n * frame.channels.length);
    const up = 16 - frame.bitsPerSample;
    frame.channels.forEach((plane, c) => {
      for (let i = 0; i < n; i++) data[c * n + i] = plane[i]! << up;
    });
    return new AudioSample({ ...common, format: "s16-planar", data });
  }
  const data = new Int32Array(n * frame.channels.length);
  const up = 32 - frame.bitsPerSample;
  frame.channels.forEach((plane, c) => {
    for (let i = 0; i < n; i++) data[c * n + i] = plane[i]! << up;
  });
  return new AudioSample({ ...common, format: "s32-planar", data });
}

class TsFlacDecoder extends CustomAudioDecoder {
  private info: FlacStreamInfo | null = null;

  static override supports(codec: AudioCodec): boolean {
    return codec === "flac";
  }

  init(): void {
    this.info = parseStreamInfo(this.config.description);
  }

  decode(packet: EncodedPacket): void {
    this.onSample(toSample(decodeFlacFrame(packet.data, this.info), packet.timestamp));
  }

  flush(): void {}
  close(): void {}
}

let registered = false;

/** Use the TS decoder for FLAC in this Mediabunny instance (idempotent). */
export function registerFlacDecoder(): void {
  if (registered) return;
  registered = true;
  registerDecoder(TsFlacDecoder);
}
