/** Promise API over `media.worker.ts`, with a main-thread Web Audio fallback for codecs the Worker can't decode. */
import type { DecodeRange, PcmAudio } from "../engine/media/audio-decode";
import type { MediaErrorKind, MediaOp, MediaOps, MediaResponse } from "./media-protocol";

export class MediaError extends Error {
  constructor(
    message: string,
    readonly kind: MediaErrorKind,
  ) {
    super(message);
  }
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./media.worker.ts", import.meta.url), { type: "module", name: "media" });
  worker.onmessage = (event: MessageEvent<MediaResponse>) => {
    const response = event.data;
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (response.ok) entry.resolve(response.result);
    else entry.reject(new MediaError(response.error.message, response.error.kind));
  };
  worker.onerror = (event) => {
    const error = new MediaError(event.message || "The media worker stopped unexpectedly.", "failed");
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function call<K extends MediaOp>(op: K, args: MediaOps[K]["args"], transfer: Transferable[] = []): Promise<MediaOps[K]["result"]> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    getWorker().postMessage({ id, op, args }, { transfer });
  });
}

/**
 * Last resort for codecs WebCodecs can't decode here: the browser's `decodeAudioData`.
 * It resamples to the context rate (the native rate isn't exposed), so drop detection on
 * this path can differ slightly from the desktop.
 */
async function decodeWithWebAudio(file: Blob, range?: DecodeRange): Promise<PcmAudio> {
  const context = new OfflineAudioContext(2, 1, 44_100);
  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new MediaError("could not be decoded by this browser", "unsupported");
  }
  const from = range ? Math.max(0, Math.round(range.start * buffer.sampleRate)) : 0;
  const to = range ? Math.min(buffer.length, Math.round((range.start + range.duration) * buffer.sampleRate)) : buffer.length;
  const planes = [0, Math.min(1, buffer.numberOfChannels - 1)].map((c) => buffer.getChannelData(c).slice(from, to));
  if (!planes[0]!.length) throw new MediaError("contains no usable audio", "empty");
  return { sampleRate: buffer.sampleRate, channels: planes };
}

const unsupported = (error: unknown) => error instanceof MediaError && error.kind === "unsupported";

export async function decodeAudioFile(file: Blob, range?: DecodeRange): Promise<PcmAudio> {
  try {
    return await call("decode", { file, range });
  } catch (error) {
    if (unsupported(error)) return decodeWithWebAudio(file, range);
    throw error;
  }
}

export async function detectDrop(file: Blob): Promise<number> {
  try {
    return await call("detectDrop", { file });
  } catch (error) {
    if (!unsupported(error)) throw error;
    const pcm = await decodeWithWebAudio(file);
    return call("detectDropPcm", { pcm }, pcm.channels.map((c) => c.buffer as ArrayBuffer));
  }
}
