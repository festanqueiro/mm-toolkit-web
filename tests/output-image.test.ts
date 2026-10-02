import { readFileSync } from "node:fs";
import { decode, encode } from "fast-png";
import { describe, expect, it } from "vitest";
import { canvasSize, hexColor, parseHexColor, previewSize, PROFILES, QUALITIES, videoBitrate } from "../src/engine/video-creator";
import { decodeImage } from "../src/io/image-decode";
import { goldenFile } from "./golden";

describe("output options", () => {
  it("profiles in desktop order", () => {
    expect(PROFILES.map((p) => p.label)).toEqual(["Visual native", "Vertical 1080 × 1920", "Square 1080 × 1080", "Landscape 1920 × 1080"]);
  });

  it("canvas: profile size, or native rounded down to even", () => {
    expect(canvasSize([1080, 1920], [801, 1201])).toEqual([1080, 1920]);
    expect(canvasSize(null, [801, 1201])).toEqual([800, 1200]);
  });

  it("preview: longest edge capped at 540, never upscaled", () => {
    expect(previewSize([1080, 1920])).toEqual([304, 540]);
    expect(previewSize([1920, 1080])).toEqual([540, 304]);
    expect(previewSize([64, 48])).toEqual([64, 48]);
  });

  it("bitrate = w × h × fps × bpp; High is the default 0.14", () => {
    expect(QUALITIES.map((q) => q.value)).toEqual(["maximum", "high", "standard", "small"]);
    expect(videoBitrate([1080, 1920], 24, "high")).toBe(Math.round(1080 * 1920 * 24 * 0.14));
  });

  it("hex colour round-trip", () => {
    expect(hexColor([25, 25, 29])).toBe("#19191d");
    expect(parseHexColor("#19191D")).toEqual([25, 25, 29]);
    expect(parseHexColor("nope")).toBeNull();
  });
});

describe("decodeImage (PNG path, Pillow convert semantics)", () => {
  const file = (bytes: Uint8Array, name = "x.png") => new File([bytes as Uint8Array<ArrayBuffer>], name);

  it("RGB and RGBA PNGs decode to their exact bytes", async () => {
    for (const name of ["frames/input.png", "frames/overlay-rgba.png"]) {
      const bytes = readFileSync(goldenFile(name));
      const ref = decode(bytes);
      const image = await decodeImage(file(bytes));
      expect([image.width, image.height, image.channels]).toEqual([ref.width, ref.height, ref.channels]);
      expect(Buffer.from(image.data).equals(Buffer.from(ref.data as Uint8Array))).toBe(true);
    }
  });

  it("grayscale(+alpha) expands to RGB(A); 16-bit keeps the high byte", async () => {
    const gray = await decodeImage(file(encode({ width: 2, height: 1, channels: 1, depth: 8, data: Uint8Array.from([10, 200]) })));
    expect([gray.channels, ...gray.data]).toEqual([3, 10, 10, 10, 200, 200, 200]);
    const ga = await decodeImage(file(encode({ width: 1, height: 1, channels: 2, depth: 8, data: Uint8Array.from([7, 128]) })));
    expect([ga.channels, ...ga.data]).toEqual([4, 7, 7, 7, 128]);
    const deep = await decodeImage(file(encode({ width: 1, height: 1, channels: 3, depth: 16, data: Uint16Array.from([0x1234, 0xff00, 0x00ff]) })));
    expect([...deep.data]).toEqual([0x12, 0xff, 0x00]);
  });

  it("rejects bytes that aren't an image", async () => {
    await expect(decodeImage(file(new TextEncoder().encode("not an image")))).rejects.toThrow();
  });
});
