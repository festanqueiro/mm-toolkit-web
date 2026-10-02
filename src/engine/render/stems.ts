/**
 * Stem splitting job (spec 15). Runs in the job Worker: decode → 44.1 kHz stereo → HT-Demucs
 * (onnxruntime-web: WebGPU, else WASM) segment by segment → one streaming encoder per chosen
 * stem → output sink.
 */
import * as ort from "onnxruntime-web/webgpu";
// The WebGPU bundle's built-in glue targets the asyncify build (ORT 1.30); a mismatched binary crashes at init.
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import { resample } from "../audio/resample";
import { AudioDecodeError, decodeAudio, type PcmAudio } from "../media/audio-decode";
import { mediaKind } from "../media-kind";
import { MP3_BITRATES } from "../converter";
import type { ConflictPolicy } from "../naming";
import { BINS, FRAMES, postForward, preForward, SAMPLE_RATE, SEGMENT } from "../stems/demucs";
import { HTDEMUCS, loadModel, modelCached, ModelDownloadError, type ModelDescriptor } from "../stems/model";
import { downloadingModel, finishedStems, orderStems, preparing, separating, STEM_MESSAGES, STEM_PROGRESS, stemOutputName, type StemChoice, type StemFormat } from "../stems/rules";
import { separate } from "../stems/separate";
import type { OutputRef, OutputSink } from "../../io/sink";
import { CancelledError } from "./cancel";
import { createPcmEncoder, UndecodableAudioError, type JobCallbacks, type PcmEncoder } from "./transcode";

/** `model`: tests substitute a stand-in; `pcm`: the source decoded by the page (see transcode). */
export type StemJob = {
  source: File;
  stems: StemChoice[];
  format: StemFormat;
  bitrate: string;
  conflict: ConflictPolicy;
  model?: ModelDescriptor;
  pcm?: PcmAudio;
};

/** Model output order. */
const MODEL_INDEX = { drums: 0, bass: 1, other: 2, vocals: 3 } as const;

/** Lossy bitrates: the chosen MP3 bitrate; AAC 256k and Opus 192k as in the Converter. */
const targetFor = (format: StemFormat, bitrate: string) => ({
  kind: "audio" as const,
  format,
  bitrate: format === "mp3" ? parseInt(bitrate, 10) * 1000 : format === "ogg" ? 192_000 : 256_000,
});

async function webGpuAvailable(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function createSession(model: Awaited<ReturnType<typeof loadModel>>, warn: (m: string) => void): Promise<ort.InferenceSession> {
  ort.env.wasm.numThreads = 1; // No cross-origin isolation on GitHub Pages (spec 13).
  ort.env.wasm.wasmPaths = { wasm: new URL(ortWasmUrl, self.location.href).href };
  const options = (ep: string): ort.InferenceSession.SessionOptions => ({
    executionProviders: [ep],
    graphOptimizationLevel: "all",
    ...(model.data ? { externalData: [{ path: model.data.path, data: model.data.data }] } : {}),
  });
  if (await webGpuAvailable()) {
    try {
      return await ort.InferenceSession.create(model.graph, options("webgpu"));
    } catch {
      // Fall through to WASM.
    }
  }
  warn(STEM_MESSAGES.noWebGpu);
  return ort.InferenceSession.create(model.graph, options("wasm"));
}

/** The source as 44.1 kHz stereo (mono duplicated); the page decodes what the Worker can't. */
async function sourcePcm(job: StemJob): Promise<[Float32Array, Float32Array]> {
  let pcm = job.pcm;
  if (!pcm) {
    try {
      pcm = await decodeAudio(job.source);
    } catch (error) {
      if (!(error instanceof AudioDecodeError) || error.kind !== "unsupported") {
        throw new Error(`${job.source.name} ${(error as Error).message}.`, { cause: error });
      }
      const input = new Input({ source: new BlobSource(job.source), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryAudioTrack();
        throw new UndecodableAudioError(job.source.name, track?.codec ?? null, track?.sampleRate ?? 44_100, track?.numberOfChannels ?? 2);
      } finally {
        input.dispose();
      }
    }
  }
  const stereo = [pcm.channels[0]!, pcm.channels[1] ?? pcm.channels[0]!];
  const [left, right] = pcm.sampleRate === SAMPLE_RATE ? stereo : resample(stereo, pcm.sampleRate, SAMPLE_RATE);
  return [left!, right!];
}

export async function splitStemsJob(job: StemJob, sink: OutputSink, cb: JobCallbacks): Promise<OutputRef[]> {
  const stems = orderStems(job.stems);
  if (!stems.length) throw new Error("Choose at least one stem.");
  if (!mediaKind(job.source.name)) throw new Error("Choose a supported audio or video source.");
  if (!(MP3_BITRATES as readonly string[]).includes(job.bitrate)) throw new Error("Audio bitrate must be 128k, 192k, 256k, or 320k.");
  const checkCancel = () => {
    if (cb.cancelled()) throw new CancelledError();
  };
  const name = job.source.name;
  cb.progress(0, preparing(name));

  // Names first: a "skip" conflict drops that stem before any work.
  const planned: { stem: StemChoice; name: string }[] = [];
  for (const stem of stems) {
    const resolved = await sink.resolveName(stemOutputName(name, stem, job.format), job.conflict);
    if (resolved !== null) planned.push({ stem, name: resolved });
  }
  if (!planned.length) {
    cb.progress(100, finishedStems(0));
    return [];
  }

  const [left, right] = await sourcePcm(job);
  checkCancel();

  const descriptor = job.model ?? HTDEMUCS;
  const downloading = !(await modelCached(descriptor));
  let model;
  try {
    model = await loadModel(descriptor, (fraction) => {
      if (downloading) cb.progress(Math.round(fraction * 10), downloadingModel(fraction));
    });
  } catch (error) {
    if (error instanceof ModelDownloadError) throw new Error(error.kind === "damaged" ? STEM_MESSAGES.damaged : STEM_MESSAGES.downloadFailed, { cause: error });
    throw error;
  }
  checkCancel();
  cb.progress(10, preparing(name));
  const session = await createSession(model, cb.warn);

  const encoders: { stem: StemChoice; name: string; encoder: PcmEncoder }[] = [];
  try {
    for (const plan of planned) encoders.push({ ...plan, encoder: await createPcmEncoder(targetFor(job.format, job.bitrate), SAMPLE_RATE, 2) });
    const runSegment = async (l: Float32Array, r: Float32Array) => {
      const { x, xt, norm } = preForward(l, r);
      const out = await session.run({ x: new ort.Tensor("float32", x, [1, 4, BINS, FRAMES]), xt: new ort.Tensor("float32", xt, [1, 2, SEGMENT]) });
      const result = postForward(out.x_out!.data as Float32Array, out.xt_out!.data as Float32Array, norm);
      for (const tensor of Object.values(out)) tensor.dispose();
      return result;
    };
    await separate(
      left,
      right,
      runSegment,
      async (region) => {
        for (const { stem, encoder } of encoders) {
          if (stem === "instrumental") {
            const mix = [0, 1].map((c) => {
              const out = new Float32Array(region[0]![c]!.length);
              for (const k of [MODEL_INDEX.drums, MODEL_INDEX.bass, MODEL_INDEX.other]) {
                const plane = region[k]![c]!;
                for (let i = 0; i < out.length; i++) out[i] = out[i]! + plane[i]!;
              }
              return out;
            });
            await encoder.push(mix);
          } else {
            await encoder.push(region[MODEL_INDEX[stem]]!);
          }
        }
      },
      {
        checkCancel,
        onSegment: (i, n) => cb.progress(10 + Math.round((i / n) * 85), separating(name, i, n)),
      },
    );

    cb.progress(95, STEM_PROGRESS.writing);
    const outputs: OutputRef[] = [];
    for (const { name: file, encoder } of encoders) {
      checkCancel();
      const bytes = await encoder.finish();
      try {
        const writer = (await sink.create(file)).getWriter();
        await writer.write(bytes);
        await writer.close();
        outputs.push(await sink.complete(file));
      } catch (error) {
        await sink.remove(file).catch(() => {});
        throw error;
      }
    }
    cb.progress(100, finishedStems(outputs.length));
    return outputs;
  } catch (error) {
    for (const { name: file, encoder } of encoders) {
      await encoder.cancel();
      await sink.remove(file).catch(() => {});
    }
    throw error;
  } finally {
    await session.release().catch(() => {});
  }
}
