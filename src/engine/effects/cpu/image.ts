/** Interleaved 8-bit images for the CPU reference effects (row-major, top row first). */

export type Image8 = { width: number; height: number; channels: 3 | 4; data: Uint8Array };

export const createImage = (width: number, height: number, channels: 3 | 4): Image8 => ({
  width,
  height,
  channels,
  data: new Uint8Array(width * height * channels),
});

export const cloneImage = (image: Image8): Image8 => ({ ...image, data: image.data.slice() });

export function solidImage(width: number, height: number, rgb: readonly [number, number, number]): Image8 {
  const image = createImage(width, height, 3);
  for (let i = 0; i < width * height; i++) image.data.set(rgb, i * 3);
  return image;
}

/** float32 → uint8 the way numpy's `astype(np.uint8)` does for in-range values: truncate toward zero. */
export const truncU8 = (value: number) => (value <= 0 ? 0 : value >= 255 ? 255 : Math.trunc(value));

/** Round half to even (C `lrint`/`cvRound` in the default rounding mode). */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff !== 0.5) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

/** `cv2.addWeighted(a, alpha, b, beta, 0)` for uint8: float math, round-half-even, saturate. */
export function addWeighted(a: Image8, alpha: number, b: Image8, beta: number): Image8 {
  const out = createImage(a.width, a.height, a.channels);
  const fa = Math.fround(alpha);
  const fb = Math.fround(beta);
  for (let i = 0; i < out.data.length; i++) {
    const v = roundHalfEven(Math.fround(Math.fround(a.data[i]! * fa) + Math.fround(b.data[i]! * fb)));
    out.data[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

/** `np.roll(rows, shift, axis=1)` on the rows [y0, y1) of one channel or all channels, in place. */
export function rollRows(image: Image8, y0: number, y1: number, shift: number, channel?: number): void {
  const { width, channels, data } = image;
  const s = ((shift % width) + width) % width;
  if (s === 0) return;
  const row = new Uint8Array(width * channels);
  for (let y = y0; y < y1; y++) {
    const base = y * width * channels;
    row.set(data.subarray(base, base + width * channels));
    for (let x = 0; x < width; x++) {
      const src = ((x - s + width) % width) * channels;
      if (channel === undefined) for (let c = 0; c < channels; c++) data[base + x * channels + c] = row[src + c]!;
      else data[base + x * channels + channel] = row[src + channel]!;
    }
  }
}
