/// <reference lib="webworker" />
/** Decoding and audio analysis, kept off the UI thread (spec 01). */
import { buildBassEnvelope, detectDropTime, toMono } from "../engine/analysis/drop";
import { PeakAccumulator } from "../engine/analysis/peaks";
import { AudioDecodeError, decodeAudio, streamAudio, type PcmAudio } from "../engine/media/audio-decode";
import type { MediaRequest, MediaResponse } from "./media-protocol";

const transferables = (pcm: PcmAudio) => [...new Set(pcm.channels.map((c) => c.buffer as ArrayBuffer))];

async function handle(request: MediaRequest): Promise<{ result: unknown; transfer: Transferable[] }> {
  switch (request.op) {
    case "decode": {
      const pcm = await decodeAudio(request.args.file, request.args.range);
      // Stereo-ised mono shares one buffer; copy so both planes can be transferred.
      if (pcm.channels[0] === pcm.channels[1]) pcm.channels[1] = pcm.channels[0]!.slice();
      return { result: pcm, transfer: transferables(pcm) };
    }
    case "detectDrop": {
      const pcm = await decodeAudio(request.args.file);
      return { result: detectDropTime(toMono(pcm.channels), pcm.sampleRate), transfer: [] };
    }
    case "bassEnvelope": {
      const { file, range, fps } = request.args;
      const pcm = await decodeAudio(file, range);
      const duration = Math.min(range.duration, pcm.channels[0]!.length / pcm.sampleRate);
      const envelope = buildBassEnvelope(toMono(pcm.channels), pcm.sampleRate, fps, duration);
      return { result: { envelope, duration }, transfer: [envelope.buffer] };
    }
    case "peaks": {
      let peaks: PeakAccumulator | null = null;
      let rate = 1;
      let last = 0;
      await streamAudio(
        request.args.file,
        ({ sampleRate, frames }) => {
          rate = sampleRate;
          peaks = new PeakAccumulator(request.args.columns, frames);
        },
        (channels, offset) => {
          peaks!.add(channels, offset);
          last = Math.max(last, offset + (channels[0]?.length ?? 0));
        },
      );
      const result = (peaks as PeakAccumulator | null)?.peaks ?? new Float32Array(request.args.columns * 2);
      return { result: { peaks: result, duration: last / rate }, transfer: [result.buffer] };
    }
    case "detectDropPcm": {
      const { pcm } = request.args;
      return { result: detectDropTime(toMono(pcm.channels), pcm.sampleRate), transfer: [] };
    }
  }
}

self.onmessage = async (event: MessageEvent<MediaRequest>) => {
  const { id } = event.data;
  try {
    const { result, transfer } = await handle(event.data);
    self.postMessage({ id, ok: true, result } satisfies MediaResponse, { transfer });
  } catch (error) {
    const kind = error instanceof AudioDecodeError ? error.kind : "failed";
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ id, ok: false, error: { message, kind } } satisfies MediaResponse);
  }
};
