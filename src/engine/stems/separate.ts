/**
 * Song-level separation (spec 15): fixed-length segments with 25 % overlap and linear fades,
 * overlap-added and normalised by the summed weights (the `infer.py` reference). The song is
 * padded with silence at both ends so `_ispec`'s attenuated segment edges fall outside it.
 * Regions are emitted as soon as no later segment can change them, so memory stays bounded.
 */
import { SEGMENT } from "./demucs";

/** Stems for one stereo segment: `[stem][channel]`, each `segment` samples long. */
export type SegmentRunner = (left: Float32Array, right: Float32Array) => Promise<Float32Array[][]>;

export type SeparateOptions = {
  /** Segment length (the model's training length; smaller in tests). */
  segment?: number;
  /** Silence added at each end of the song (removed from the output). */
  pad?: number;
  /** Called before segment `index` of `count` runs. */
  onSegment?: (index: number, count: number) => void;
  /** Throw to stop (checked between segments). */
  checkCancel?: () => void;
};

export const SONG_PAD = 8192;

export function segmentCount(length: number, segment = SEGMENT, pad = SONG_PAD): number {
  const total = length + 2 * pad;
  const stride = segment - Math.floor(segment / 4);
  return Math.max(1, Math.ceil(total / stride));
}

/**
 * Separate `left`/`right` (same length, model rate) with `run`; `emit(stems, offset)` receives
 * consecutive regions `[stem][channel]` starting at sample `offset` of the song.
 */
export async function separate(
  left: Float32Array,
  right: Float32Array,
  run: SegmentRunner,
  emit: (stems: Float32Array[][], offset: number) => Promise<void> | void,
  options: SeparateOptions = {},
): Promise<void> {
  const segment = options.segment ?? SEGMENT;
  const pad = options.pad ?? SONG_PAD;
  const length = left.length;
  const total = length + 2 * pad;
  const overlap = Math.floor(segment / 4);
  const stride = segment - overlap;
  const count = segmentCount(length, segment, pad);

  // Linear fade-in/out over the overlap (np.linspace(0, 1, overlap)).
  const window = new Float32Array(segment).fill(1);
  for (let i = 0; i < overlap; i++) {
    const v = overlap > 1 ? i / (overlap - 1) : 1;
    window[i] = v;
    window[segment - 1 - i] = v;
  }

  // Accumulators covering padded samples [accStart, accStart + segment).
  let acc: Float32Array[][] | null = null;
  let weight = new Float32Array(segment);
  let accStart = 0;

  /** Padded-song sample `i` of one channel (silence outside the song). */
  const slice = (channel: Float32Array, from: number) => {
    const out = new Float32Array(segment);
    const a = Math.max(from, pad);
    const b = Math.min(from + segment, pad + length);
    if (b > a) out.set(channel.subarray(a - pad, b - pad), a - from);
    return out;
  };

  for (let index = 0; index < count; index++) {
    options.checkCancel?.();
    options.onSegment?.(index, count);
    const start = index * stride;
    const stems = await run(slice(left, start), slice(right, start));
    acc ??= stems.map((stem) => stem.map(() => new Float32Array(segment)));
    const valid = Math.min(segment, total - start);
    // Nothing overlaps the first segment's start or the last one's end: no fade there, so
    // every song sample has a non-zero weight even without padding.
    const w = index === 0 || index === count - 1 ? window.slice() : window;
    if (index === 0) w.fill(1, 0, overlap);
    if (index === count - 1) w.fill(1, segment - overlap);
    for (let s = 0; s < stems.length; s++) {
      for (let c = 0; c < stems[s]!.length; c++) {
        const src = stems[s]![c]!;
        const dst = acc[s]![c]!;
        for (let i = 0; i < valid; i++) dst[i] = dst[i]! + src[i]! * w[i]!;
      }
    }
    for (let i = 0; i < valid; i++) weight[i] = weight[i]! + w[i]!;

    // Final region: up to the next segment's start (or the song's end for the last one).
    const last = index === count - 1;
    const finalEnd = last ? total : start + stride;
    const from = Math.max(accStart, pad);
    const to = Math.min(finalEnd, pad + length);
    if (to > from) {
      const region = acc.map((stem) =>
        stem.map((plane) => {
          const out = new Float32Array(to - from);
          for (let i = 0; i < out.length; i++) {
            const k = from - accStart + i;
            out[i] = plane[k]! / Math.max(weight[k]!, 1e-8);
          }
          return out;
        }),
      );
      await emit(region, from - pad);
    }
    if (last) break;

    // Slide the accumulators by one stride.
    acc = acc.map((stem) =>
      stem.map((plane) => {
        const next = new Float32Array(segment);
        next.set(plane.subarray(stride));
        return next;
      }),
    );
    const nextWeight = new Float32Array(segment);
    nextWeight.set(weight.subarray(stride));
    weight = nextWeight;
    accStart += stride;
  }
}
