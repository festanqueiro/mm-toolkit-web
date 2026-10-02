/**
 * `validate_visual` + the 94×94 artwork thumbnail (spec 04). Validation actually decodes:
 * an image must decode, a video must yield its first frame.
 */
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import { VISUAL_MESSAGES, visualKind, type VisualKind } from "../engine/video-creator";

export type VisualProbe =
  | {
      ok: true;
      kind: VisualKind;
      message: string;
      width: number;
      height: number;
      /** Seconds; videos only. */
      duration?: number;
      /** Videos only: whether there's an audio track to (optionally) mix in. */
      hasAudio?: boolean;
      /** Object URL of a PNG thumbnail fitting 94×94; revoke with `URL.revokeObjectURL`. */
      thumbnail: string;
    }
  | { ok: false; kind: VisualKind | null; message: string };

export const THUMBNAIL_SIZE = 94;

async function thumbnailUrl(source: CanvasImageSource, width: number, height: number): Promise<string> {
  const scale = Math.min(THUMBNAIL_SIZE / width, THUMBNAIL_SIZE / height, 1);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Thumbnail encoding failed");
  return URL.createObjectURL(blob);
}

async function probeImage(file: File): Promise<VisualProbe> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image", premultiplyAlpha: "none", colorSpaceConversion: "none" });
  } catch {
    return { ok: false, kind: "image", message: VISUAL_MESSAGES.imageUnreadable };
  }
  try {
    const { width, height } = bitmap;
    return { ok: true, kind: "image", message: VISUAL_MESSAGES.imageReady, width, height, thumbnail: await thumbnailUrl(bitmap, width, height) };
  } finally {
    bitmap.close();
  }
}

async function probeVideo(file: File): Promise<VisualProbe> {
  const fail: VisualProbe = { ok: false, kind: "video", message: VISUAL_MESSAGES.videoUnreadable };
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return fail;
    const duration = await input.computeDuration();
    if (!(duration > 0)) return fail;
    const first = await new CanvasSink(track, { poolSize: 1 }).getCanvas(await track.getFirstTimestamp());
    if (!first) return fail;
    const width = track.displayWidth;
    const height = track.displayHeight;
    const hasAudio = (await input.getPrimaryAudioTrack()) !== null;
    return {
      ok: true,
      kind: "video",
      message: VISUAL_MESSAGES.videoReady,
      width,
      height,
      duration,
      hasAudio,
      thumbnail: await thumbnailUrl(first.canvas as CanvasImageSource, width, height),
    };
  } catch {
    return fail;
  } finally {
    input.dispose();
  }
}

export function probeVisual(file: File): Promise<VisualProbe> {
  const kind = visualKind(file.name);
  if (kind === "image") return probeImage(file);
  if (kind === "video") return probeVideo(file);
  return Promise.resolve({ ok: false, kind: null, message: VISUAL_MESSAGES.unsupported });
}
