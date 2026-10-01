/**
 * Resampling primitives reproducing the desktop's libraries for golden parity (spec 03):
 * OpenCV `resize` (INTER_LINEAR, fixed-point) and `warpAffine` (INTER_LINEAR, OpenCV 5
 * float kernels), and Pillow `resize` (LANCZOS, 8-bit fixed-point, premultiplied RGBA)
 * + `ImageOps.contain`/`fit`.
 */

import { pyRound } from "../../py";
import { createImage, roundHalfEven, type Image8 } from "./image";

// ---------------------------------------------------------------- OpenCV resize

const RESIZE_COEF_SCALE = 2048; // INTER_RESIZE_COEF_BITS = 11

function linearTaps(dst: number, src: number): { index: Int32Array; weight: Int32Array } {
  const scale = src / dst;
  const index = new Int32Array(dst);
  const weight = new Int32Array(dst * 2);
  for (let d = 0; d < dst; d++) {
    let f = Math.fround((d + 0.5) * scale - 0.5);
    let s = Math.floor(f);
    f -= s;
    if (s < 0) {
      f = 0;
      s = 0;
    }
    if (s >= src - 1) {
      f = 0;
      s = src - 1;
    }
    index[d] = s;
    const w0 = roundHalfEven((1 - f) * RESIZE_COEF_SCALE);
    weight[d * 2] = w0;
    weight[d * 2 + 1] = RESIZE_COEF_SCALE - w0;
  }
  return { index, weight };
}

/** `cv2.resize(img, (width, height), interpolation=cv2.INTER_LINEAR)` for uint8 images. */
export function cvResizeLinear(image: Image8, width: number, height: number): Image8 {
  const { channels, data } = image;
  const out = createImage(width, height, channels);
  const xs = linearTaps(width, image.width);
  const ys = linearTaps(height, image.height);
  const rowA = new Int32Array(width * channels);
  const rowB = new Int32Array(width * channels);
  const horizontal = (y: number, row: Int32Array) => {
    const base = y * image.width * channels;
    for (let x = 0; x < width; x++) {
      const sx = xs.index[x]!;
      const sx1 = Math.min(sx + 1, image.width - 1);
      const a0 = xs.weight[x * 2]!;
      const a1 = xs.weight[x * 2 + 1]!;
      for (let c = 0; c < channels; c++) {
        row[x * channels + c] = data[base + sx * channels + c]! * a0 + data[base + sx1 * channels + c]! * a1;
      }
    }
  };
  for (let y = 0; y < height; y++) {
    const sy = ys.index[y]!;
    horizontal(sy, rowA);
    horizontal(Math.min(sy + 1, image.height - 1), rowB);
    const b0 = ys.weight[y * 2]!;
    const b1 = ys.weight[y * 2 + 1]!;
    for (let i = 0; i < width * channels; i++) {
      // OpenCV VResizeLinear<uchar>: ((b0*(S0>>4))>>16) + ((b1*(S1>>4))>>16) + 2) >> 2
      const v = (((b0 * (rowA[i]! >> 4)) >> 16) + ((b1 * (rowB[i]! >> 4)) >> 16) + 2) >> 2;
      out.data[y * width * channels + i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return out;
}

// ---------------------------------------------------------------- OpenCV warpAffine

export type AffineMatrix = [number, number, number, number, number, number];

/** `cv2.getRotationMatrix2D(center, angle, scale)`; positive angle = counter-clockwise. */
export function rotationMatrix(cx: number, cy: number, angleDegrees: number, scale = 1): AffineMatrix {
  const angle = (angleDegrees * Math.PI) / 180;
  const alpha = Math.cos(angle) * scale;
  const beta = Math.sin(angle) * scale;
  return [alpha, beta, (1 - alpha) * cx - beta * cy, -beta, alpha, beta * cx + (1 - alpha) * cy];
}

export type BorderMode = "replicate" | "constant";

const f32 = Math.fround;

/**
 * `cv2.warpAffine(img, M, (w, h), flags=INTER_LINEAR, borderMode=...)` as implemented by
 * OpenCV ≥ 4.11 / 5.x (the desktop runs 5.0): M (source → destination) is inverted in
 * float64, then per pixel the source coordinate and the bilinear lerps are evaluated in
 * float32 and rounded half-to-even. Verified bit-exact against OpenCV 5.0 output.
 */
export function cvWarpAffine(image: Image8, matrix: AffineMatrix, border: BorderMode, borderValue = 0): Image8 {
  const { width, height, channels, data } = image;
  const out = createImage(width, height, channels);
  const [, , m2, , , m5] = matrix;
  let [m0, m1, , m3, m4] = matrix;
  let det = m0 * m4 - m1 * m3;
  det = det !== 0 ? 1 / det : 0;
  const a11 = m4 * det;
  const a22 = m0 * det;
  m1 = -m1 * det;
  m3 = -m3 * det;
  m0 = a11;
  m4 = a22;
  const b1 = -m0 * m2 - m1 * m5;
  const b2 = -m3 * m2 - m4 * m5;
  const [i0, i1, i2, i3, i4, i5] = [m0, m1, b1, m3, m4, b2].map(f32) as AffineMatrix;
  const sample = (px: number, py: number, c: number) => {
    if (border === "replicate") {
      const x = px < 0 ? 0 : px >= width ? width - 1 : px;
      const y = py < 0 ? 0 : py >= height ? height - 1 : py;
      return data[(y * width + x) * channels + c]!;
    }
    return px < 0 || py < 0 || px >= width || py >= height ? borderValue : data[(py * width + px) * channels + c]!;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = f32(f32(f32(i0 * x) + f32(i1 * y)) + i2);
      const sy = f32(f32(f32(i3 * x) + f32(i4 * y)) + i5);
      const ix = Math.floor(sx);
      const iy = Math.floor(sy);
      const a = f32(sx - ix);
      const b = f32(sy - iy);
      const o = (y * width + x) * channels;
      for (let c = 0; c < channels; c++) {
        const p00 = sample(ix, iy, c);
        const p01 = sample(ix + 1, iy, c);
        const p10 = sample(ix, iy + 1, c);
        const p11 = sample(ix + 1, iy + 1, c);
        const v0 = f32(p00 + f32(a * (p01 - p00)));
        const v1 = f32(p10 + f32(a * (p11 - p10)));
        const v = roundHalfEven(f32(v0 + f32(b * f32(v1 - v0))));
        out.data[o + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- Pillow LANCZOS

const PRECISION_BITS = 32 - 8 - 2;

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const lanczos = (x: number) => (x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0);

function lanczosCoefficients(inSize: number, in0: number, in1: number, outSize: number) {
  const scale = (in1 - in0) / outSize;
  const filterScale = Math.max(scale, 1);
  const support = 3 * filterScale;
  const bounds: Array<[number, number]> = [];
  const weights: Int32Array[] = [];
  for (let xx = 0; xx < outSize; xx++) {
    const center = in0 + (xx + 0.5) * scale;
    const xmin = Math.max(Math.trunc(center - support + 0.5), 0);
    const xmax = Math.min(Math.trunc(center + support + 0.5), inSize) - xmin;
    const k = new Float64Array(xmax);
    let ww = 0;
    for (let x = 0; x < xmax; x++) {
      k[x] = lanczos((x + xmin - center + 0.5) / filterScale);
      ww += k[x]!;
    }
    const fixed = new Int32Array(xmax);
    for (let x = 0; x < xmax; x++) {
      const w = ww !== 0 ? k[x]! / ww : k[x]!;
      fixed[x] = Math.trunc(w < 0 ? -0.5 + w * (1 << PRECISION_BITS) : 0.5 + w * (1 << PRECISION_BITS));
    }
    bounds.push([xmin, xmax]);
    weights.push(fixed);
  }
  return { bounds, weights };
}

const clip8 = (sum: number) => {
  const v = Math.floor(sum / 2 ** PRECISION_BITS);
  return v < 0 ? 0 : v > 255 ? 255 : v;
};

/** One Pillow resample pass along x (horizontal) or y (vertical). */
function resamplePass(image: Image8, outSize: number, box0: number, box1: number, horizontal: boolean): Image8 {
  const { width, height, channels, data } = image;
  const inSize = horizontal ? width : height;
  const { bounds, weights } = lanczosCoefficients(inSize, box0, box1, outSize);
  const out = horizontal ? createImage(outSize, height, channels) : createImage(width, outSize, channels);
  const half = 2 ** (PRECISION_BITS - 1);
  for (let o = 0; o < outSize; o++) {
    const [min, count] = bounds[o]!;
    const k = weights[o]!;
    const lines = horizontal ? height : width;
    for (let line = 0; line < lines; line++) {
      for (let c = 0; c < channels; c++) {
        let sum = half;
        for (let i = 0; i < count; i++) {
          const src = horizontal ? (line * width + min + i) * channels + c : ((min + i) * width + line) * channels + c;
          sum += data[src]! * k[i]!;
        }
        const dst = horizontal ? (line * outSize + o) * channels + c : (o * width + line) * channels + c;
        out.data[dst] = clip8(sum);
      }
    }
  }
  return out;
}

function premultiply(image: Image8): Image8 {
  const out = { ...image, data: image.data.slice() };
  for (let i = 0; i < out.data.length; i += 4) {
    const a = out.data[i + 3]!;
    for (let c = 0; c < 3; c++) {
      const t = out.data[i + c]! * a + 128;
      out.data[i + c] = ((t >> 8) + t) >> 8;
    }
  }
  return out;
}

function unpremultiply(image: Image8): Image8 {
  for (let i = 0; i < image.data.length; i += 4) {
    const a = image.data[i + 3]!;
    for (let c = 0; c < 3; c++) {
      image.data[i + c] = a === 0 ? 0 : Math.min(255, Math.trunc((255 * image.data[i + c]!) / a));
    }
  }
  return image;
}

/**
 * `Image.resize((width, height), Image.LANCZOS, box)` — horizontal then vertical pass,
 * each rounded to 8 bits; RGBA is resampled premultiplied ("RGBa") like Pillow.
 */
export function pillowResize(image: Image8, width: number, height: number, box?: [number, number, number, number]): Image8 {
  const [x0, y0, x1, y1] = box ?? [0, 0, image.width, image.height];
  let work = image.channels === 4 ? premultiply(image) : image;
  const needHorizontal = width !== image.width || x0 !== 0 || x1 !== width;
  const needVertical = height !== image.height || y0 !== 0 || y1 !== height;
  if (needHorizontal) work = resamplePass(work, width, x0, x1, true);
  if (needVertical) work = resamplePass(work, height, y0, y1, false);
  if (work === image) work = { ...image, data: image.data.slice() };
  return image.channels === 4 ? unpremultiply(work) : work;
}

/** `ImageOps.contain(image, (w, h), LANCZOS)`: largest size fitting inside, aspect kept. */
export function pillowContain(image: Image8, width: number, height: number): Image8 {
  const imRatio = image.width / image.height;
  const destRatio = width / height;
  let size: [number, number] = [width, height];
  if (imRatio !== destRatio) {
    if (imRatio > destRatio) {
      const newHeight = pyRound((image.height / image.width) * width);
      if (newHeight !== height) size = [width, newHeight];
    } else {
      const newWidth = pyRound((image.width / image.height) * height);
      if (newWidth !== width) size = [newWidth, height];
    }
  }
  return pillowResize(image, size[0], size[1]);
}

/** `ImageOps.fit(image, (w, h), LANCZOS)`: centred crop to the target ratio, then resize (cover). */
export function pillowFit(image: Image8, width: number, height: number): Image8 {
  const liveRatio = image.width / image.height;
  const outputRatio = width / height;
  let cropWidth = image.width;
  let cropHeight = image.height;
  if (liveRatio !== outputRatio) {
    if (liveRatio >= outputRatio) cropWidth = outputRatio * image.height;
    else cropHeight = image.width / outputRatio;
  }
  const left = (image.width - cropWidth) * 0.5;
  const top = (image.height - cropHeight) * 0.5;
  return pillowResize(image, width, height, [left, top, left + cropWidth, top + cropHeight]);
}

/** Paste `src` onto a copy of `canvas` at integer offset (same channel count), like `Image.paste` without mask. */
export function paste(canvas: Image8, src: Image8, left: number, top: number): Image8 {
  const out = { ...canvas, data: canvas.data.slice() };
  const ch = canvas.channels;
  for (let y = 0; y < src.height; y++) {
    const ty = top + y;
    if (ty < 0 || ty >= canvas.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = left + x;
      if (tx < 0 || tx >= canvas.width) continue;
      for (let c = 0; c < ch; c++) out.data[(ty * canvas.width + tx) * ch + c] = src.data[(y * src.width + x) * src.channels + c]!;
    }
  }
  return out;
}
