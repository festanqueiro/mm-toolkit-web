/**
 * Decode a still image to 8-bit RGB/RGBA like Pillow's `Image.open(...).convert(...)`:
 * no EXIF rotation, alpha kept as-is (not premultiplied). PNG goes through fast-png for
 * exact bytes; other formats use the browser decoder (canvas readback, which is exact
 * for opaque images such as JPEG).
 */
import { decode as decodePng } from "fast-png";
import { extensionOf } from "../engine/media-kind";
import type { Image8 } from "../engine/effects/cpu/image";

export class ImageDecodeError extends Error {}

function fromPng(bytes: Uint8Array): Image8 {
  const png = decodePng(bytes);
  const { width, height } = png;
  const count = width * height;
  const src = png.data;
  const depthShift = png.depth === 16 ? 8 : 0;
  const sample = (i: number) => (depthShift ? (src[i] as number) >> depthShift : (src[i] as number));
  if (png.palette) {
    const palette = png.palette;
    const hasAlpha = palette.some((entry) => entry.length === 4 && entry[3] !== 255);
    const out: Image8 = { width, height, channels: hasAlpha ? 4 : 3, data: new Uint8Array(count * (hasAlpha ? 4 : 3)) };
    // fast-png keeps palette indices packed at the PNG bit depth.
    const bitsPerPixel = png.depth;
    const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = x * bitsPerPixel;
        const byte = src[y * rowBytes + (bit >> 3)] as number;
        const index = bitsPerPixel === 8 ? byte : (byte >> (8 - bitsPerPixel - (bit & 7))) & ((1 << bitsPerPixel) - 1);
        const entry = palette[index] ?? [0, 0, 0, 255];
        const o = (y * width + x) * out.channels;
        out.data[o] = entry[0]!;
        out.data[o + 1] = entry[1]!;
        out.data[o + 2] = entry[2]!;
        if (hasAlpha) out.data[o + 3] = entry[3] ?? 255;
      }
    }
    return out;
  }
  const channels = png.channels;
  if (channels === 3 || channels === 4) {
    const out: Image8 = { width, height, channels, data: new Uint8Array(count * channels) };
    for (let i = 0; i < count * channels; i++) out.data[i] = sample(i);
    return out;
  }
  // Grayscale (+ alpha) → RGB(A).
  const alpha = channels === 2;
  const out: Image8 = { width, height, channels: alpha ? 4 : 3, data: new Uint8Array(count * (alpha ? 4 : 3)) };
  for (let p = 0; p < count; p++) {
    const v = sample(p * channels);
    const o = p * out.channels;
    out.data[o] = out.data[o + 1] = out.data[o + 2] = v;
    if (alpha) out.data[o + 3] = sample(p * channels + 1);
  }
  return out;
}

async function fromBrowser(file: Blob): Promise<Image8> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "none" as ImageOrientation, premultiplyAlpha: "none", colorSpaceConversion: "none" });
  } catch {
    bitmap = await createImageBitmap(file, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  }
  try {
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const opaque = rgba.every((v, i) => i % 4 !== 3 || v === 255);
    if (!opaque) return { width, height, channels: 4, data: new Uint8Array(rgba.buffer.slice(0)) };
    const data = new Uint8Array(width * height * 3);
    for (let p = 0; p < width * height; p++) data.set(rgba.subarray(p * 4, p * 4 + 3), p * 3);
    return { width, height, channels: 3, data };
  } finally {
    bitmap.close();
  }
}

/** Decode `file`; throws `ImageDecodeError` when it isn't a readable image. */
export async function decodeImage(file: File): Promise<Image8> {
  try {
    if (extensionOf(file.name) === ".png") return fromPng(new Uint8Array(await file.arrayBuffer()));
    return await fromBrowser(file);
  } catch (error) {
    if (extensionOf(file.name) === ".png") {
      // Not actually a PNG (or a variant fast-png can't read): let the browser try.
      try {
        return await fromBrowser(file);
      } catch {
        // fall through
      }
    }
    throw new ImageDecodeError(error instanceof Error ? error.message : String(error));
  }
}
