/**
 * Media Cutter source validation (desktop `ffprobe` check): the extension picks the kind,
 * then the container must parse and carry a stream of that kind. Reads headers only.
 */
import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import { SOURCE_STATUS } from "../engine/clips";
import { isAiff } from "../engine/media/aiff";
import { extensionOf, mediaKind, type MediaKind } from "../engine/media-kind";

export type SourceProbe = { ok: true; kind: MediaKind } | { ok: false; message: string };

export async function probeSource(file: File): Promise<SourceProbe> {
  const kind = mediaKind(file.name);
  const unsupported: SourceProbe = { ok: false, message: SOURCE_STATUS.unsupported };
  if (!kind) return unsupported;
  const ext = extensionOf(file.name);
  if (ext === ".aif" || ext === ".aiff") return isAiff(await file.slice(0, 12).arrayBuffer()) ? { ok: true, kind } : unsupported;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = kind === "video" ? await input.getPrimaryVideoTrack() : await input.getPrimaryAudioTrack();
    return track ? { ok: true, kind } : unsupported;
  } catch {
    return unsupported;
  } finally {
    input.dispose();
  }
}
