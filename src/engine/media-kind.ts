/** Extension tables and media-kind detection — port of `core.py` constants and `media_kind`. */

export const AUDIO_EXTENSIONS = [".aac", ".aif", ".aiff", ".flac", ".m4a", ".mp3", ".ogg", ".wav", ".wave"] as const;
export const IMAGE_EXTENSIONS = [".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"] as const;
export const VIDEO_EXTENSIONS = [".avi", ".m4v", ".mkv", ".mov", ".mp4", ".webm"] as const;
export const AUDIO_OUTPUT_FORMATS = ["mp3", "wav", "aiff", "flac", "m4a", "aac", "ogg"] as const;
export const VIDEO_OUTPUT_FORMATS = ["mp4", "mov", "mkv", "avi", "webm"] as const;

export type MediaKind = "audio" | "video";

/** Lower-cased extension including the dot, or "" (Python `Path.suffix` semantics). */
export function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

export function mediaKind(name: string): MediaKind | null {
  const ext = extensionOf(name);
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) return "audio";
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return "video";
  return null;
}
