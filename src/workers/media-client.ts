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

/**
 * Two workers: a waveform decodes a whole file, and a snippet asked for meanwhile (a preview
 * the user is waiting on) mustn't queue behind it.
 */
type Lane = { name: string; worker: Worker | null; pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }> };
const lanes = { main: { name: "media", worker: null, pending: new Map() } as Lane, peaks: { name: "media-peaks", worker: null, pending: new Map() } as Lane };
let nextId = 1;

function getWorker(lane: Lane): Worker {
  if (lane.worker) return lane.worker;
  const worker = new Worker(new URL("./media.worker.ts", import.meta.url), { type: "module", name: lane.name });
  lane.worker = worker;
  worker.onmessage = (event: MessageEvent<MediaResponse>) => {
    const response = event.data;
    const entry = lane.pending.get(response.id);
    if (!entry) return;
    lane.pending.delete(response.id);
    if (response.ok) entry.resolve(response.result);
    else entry.reject(new MediaError(response.error.message, response.error.kind));
  };
  worker.onerror = (event) => {
    const error = new MediaError(event.message || "The media worker stopped unexpectedly.", "failed");
    for (const entry of lane.pending.values()) entry.reject(error);
    lane.pending.clear();
    worker.terminate();
    if (lane.worker === worker) lane.worker = null;
  };
  return worker;
}

function call<K extends MediaOp>(op: K, args: MediaOps[K]["args"], transfer: Transferable[] = []): Promise<MediaOps[K]["result"]> {
  const id = nextId++;
  const lane = op === "peaks" ? lanes.peaks : lanes.main;
  return new Promise((resolve, reject) => {
    lane.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    getWorker(lane).postMessage({ id, op, args }, { transfer });
  });
}

/**
 * Last resort for codecs WebCodecs can't decode here: the browser's `decodeAudioData`.
 * It resamples to the context rate (the native rate isn't exposed).
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

/** Bass envelope for a snippet. Throws for codecs the Worker can't decode (preview then runs without bass). */
export function bassEnvelope(file: Blob, range: DecodeRange, fps: number): Promise<{ envelope: Float64Array; duration: number }> {
  return call("bassEnvelope", { file, range, fps });
}

type Peaks = { peaks: Float32Array; duration: number };
/** Waveforms already worked out, per file: leaving a tool and coming back mustn't decode an hour of audio again. */
const peaksByFile = new WeakMap<Blob, Map<string, Promise<Peaks>>>();

async function computePeaks(file: Blob, columns: number, webAudio: boolean): Promise<Peaks> {
  try {
    return await call("peaks", { file, columns });
  } catch (error) {
    if (!webAudio || !unsupported(error)) throw error;
    const pcm = await decodeWithWebAudio(file);
    const { PeakAccumulator } = await import("../engine/analysis/peaks");
    const acc = new PeakAccumulator(columns, pcm.channels[0]!.length);
    acc.add(pcm.channels, 0);
    return { peaks: acc.peaks, duration: pcm.channels[0]!.length / pcm.sampleRate };
  }
}

/**
 * Waveform peaks for a timeline, kept for as long as the file is (treat them as read-only).
 * Web Audio decodes codecs the Worker can't, but it holds the whole file decoded: pass
 * `webAudio: false` where that isn't worth it.
 */
export function audioPeaks(file: Blob, columns: number, webAudio = true): Promise<Peaks> {
  let known = peaksByFile.get(file);
  if (!known) peaksByFile.set(file, (known = new Map()));
  const key = `${columns}|${webAudio}`;
  let peaks = known.get(key);
  if (!peaks) {
    peaks = computePeaks(file, columns, webAudio);
    known.set(key, peaks);
    // A failure isn't kept: the next request tries again.
    peaks.catch(() => known.get(key) === peaks && known.delete(key));
  }
  return peaks;
}

/**
 * The page's own decoder (Web Audio) at the file's native rate, so nothing is resampled: the
 * fallback when a Worker can't decode the codec. Holds the whole file as PCM.
 */
export async function decodeAtNativeRate(file: Blob, sampleRate: number, numberOfChannels: number): Promise<PcmAudio> {
  const context = new OfflineAudioContext(Math.max(1, numberOfChannels), 1, sampleRate);
  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new MediaError("could not be decoded by this browser", "unsupported");
  }
  return { sampleRate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)) };
}
