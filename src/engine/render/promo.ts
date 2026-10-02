/**
 * Promo render pipeline: port of `core.generate_videos` / `render_track` (spec 04).
 * Runs in a Worker: decode → envelope → layers → WebGL cascade + fades → WebCodecs
 * (H.264 + AAC preferred) → MP4 → output sink. Tracks render sequentially.
 */
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  canEncodeAudio,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type VideoCodec,
} from "mediabunny";
import { buildBassEnvelope, envelopeAt, toMono } from "../analysis/drop";
import { loopTo, PROMO_AUDIO_RATE, resample } from "../audio/resample";
import { applyEffectChain, applyVideoFade, buildBackgroundFrame, dropAlpha, fitOverlayFrame, fitVisualFrame } from "../effects/cpu/effects";
import type { Image8 } from "../effects/cpu/image";
import { applyAudioFade, fadeLength, videoFadeGain } from "../effects/fade";
import { GlEffectRenderer, WebGLUnavailableError, type FrameOptions } from "../effects/gl/renderer";
import type { EffectSettings } from "../effects/settings";
import { AudioDecodeError, decodeAudio } from "../media/audio-decode";
import { CancelledError } from "./cancel";
import { safeFilename, type ConflictPolicy } from "../naming";
import { formatTemplate, PROMO_TEMPLATE_ERROR } from "../template";
import { canvasSize, videoBitrate, type Quality, type Size } from "../video-creator";
import type { OutputRef, OutputSink } from "../../io/sink";

export type PromoTrack = { file: File; start: number; duration: number };

export type PromoJob = {
  tracks: PromoTrack[];
  visual: { file: File; kind: "image" | "video"; image: Image8 | null };
  effects: EffectSettings;
  backgroundImage: Image8 | null;
  overlayImage: Image8 | null;
  profile: Size | null;
  fps: number;
  quality: Quality;
  audioBitrate: number;
  videoFade: boolean;
  audioFade: boolean;
  muteOriginalVideoAudio: boolean;
  naming: string;
  conflict: ConflictPolicy;
};

export type PromoCallbacks = {
  progress: (percent: number, status: string) => void;
  /** Non-fatal notes, e.g. a codec fallback. */
  warn: (message: string) => void;
  cancelled: () => boolean;
};

export { CancelledError };

const stem = (name: string) => (name.lastIndexOf(".") > 0 ? name.slice(0, name.lastIndexOf(".")) : name);

/** Frame count of a moviepy clip written at `fps`: `len(np.arange(0, duration, 1/fps))`. */
export const frameCountFor = (duration: number, fps: number) => Math.max(1, Math.ceil(duration * fps - 1e-9));

/** Output name for track `index` (`{track}`, 1-based `{number}`), before conflict handling. */
export function promoOutputName(template: string, file: string, index: number): string {
  let formatted: string;
  try {
    formatted = formatTemplate(template, { track: stem(file), number: index + 1 });
  } catch (error) {
    throw new Error(PROMO_TEMPLATE_ERROR, { cause: error });
  }
  return `${safeFilename(formatted)}.mp4`;
}

const rgba = (image: Image8): Image8 => {
  if (image.channels === 4) return image;
  const data = new Uint8Array(image.width * image.height * 4);
  for (let p = 0; p < image.width * image.height; p++) {
    data[p * 4] = image.data[p * 3]!;
    data[p * 4 + 1] = image.data[p * 3 + 1]!;
    data[p * 4 + 2] = image.data[p * 3 + 2]!;
    data[p * 4 + 3] = 255;
  }
  return { width: image.width, height: image.height, channels: 4, data };
};

async function pickAudioCodec(bitrate: number, warn: PromoCallbacks["warn"]): Promise<{ codec: AudioCodec; sampleRate: number }> {
  if (await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: PROMO_AUDIO_RATE, bitrate })) return { codec: "aac", sampleRate: PROMO_AUDIO_RATE };
  if (await canEncodeAudio("opus", { numberOfChannels: 2, sampleRate: 48_000, bitrate })) {
    warn("This browser can't encode AAC, so the audio uses Opus. Some platforms may not accept Opus audio.");
    return { codec: "opus", sampleRate: 48_000 };
  }
  throw new Error("This browser can't encode AAC or Opus audio.");
}

async function pickVideoCodec(size: Size, bitrate: number, warn: PromoCallbacks["warn"]): Promise<VideoCodec> {
  const codec = await getFirstEncodableVideoCodec(["avc", "vp9", "av1"], { width: size[0], height: size[1], bitrate });
  if (!codec) throw new Error(`This browser can't encode ${size[0]} × ${size[1]} video.`);
  if (codec !== "avc") warn(`This browser can't encode H.264 here, so the video uses ${codec.toUpperCase()} in MP4.`);
  return codec;
}

/** Render every track; returns the outputs written (skipped tracks produce none). */
export async function renderPromoJob(job: PromoJob, sink: OutputSink, cb: PromoCallbacks): Promise<OutputRef[]> {
  if (!job.tracks.length) throw new Error("No audio files were provided.");
  // Validate the template once up front (desktop fails the job before rendering).
  promoOutputName(job.naming, job.tracks[0]!.file.name, 0);
  const outputs: OutputRef[] = [];
  const n = job.tracks.length;
  for (const [index, track] of job.tracks.entries()) {
    if (cb.cancelled()) throw new CancelledError();
    const requested = promoOutputName(job.naming, track.file.name, index);
    const name = await sink.resolveName(requested, job.conflict);
    if (name === null) continue; // "skip": an output with this name exists.
    cb.progress(Math.round((index / n) * 100), `Analysing ${track.file.name}`);
    try {
      await renderTrack(job, track, name, sink, (fraction) => {
        cb.progress(Math.round(((index + fraction) / n) * 100), `Rendering ${track.file.name}`);
      }, cb);
      outputs.push(await sink.complete(name));
    } catch (error) {
      await sink.remove(name).catch(() => {});
      throw error;
    }
  }
  return outputs;
}

async function renderTrack(
  job: PromoJob,
  track: PromoTrack,
  name: string,
  sink: OutputSink,
  onFraction: (fraction: number) => void,
  cb: PromoCallbacks,
): Promise<void> {
  // 1–3. Snippet [start, start + duration), clamped to the track end.
  let snippet;
  try {
    snippet = await decodeAudio(track.file, { start: track.start, duration: track.duration });
  } catch (error) {
    if (error instanceof AudioDecodeError && error.kind === "empty") throw new Error(`${track.file.name} contains no usable audio.`, { cause: error });
    throw new Error(`${track.file.name} ${(error as Error).message}.`, { cause: error });
  }
  const actualDuration = Math.min(track.duration, snippet.channels[0]!.length / snippet.sampleRate);
  if (actualDuration <= 0) throw new Error(`${track.file.name} contains no usable audio.`);

  // 4. Envelope (only when Bass-reactive Blur is on).
  const envelope = job.effects.bass_blur.enabled ? buildBassEnvelope(toMono(snippet.channels), snippet.sampleRate, job.fps, actualDuration) : null;

  // 5. Canvas, background, visual and overlay.
  const visualSize: Size = job.visual.image
    ? [job.visual.image.width, job.visual.image.height]
    : await videoSize(job.visual.file);
  const size = canvasSize(job.profile, visualSize);
  const bg = job.effects.background;
  const background = buildBackgroundFrame(size[0], size[1], bg.color, bg.mode === "image" ? job.backgroundImage : null);
  const overlay = job.effects.overlay.enabled && job.overlayImage ? fitOverlayFrame(rgba(job.overlayImage), size[0], size[1]) : null;
  const stillFrame = job.visual.image ? fitVisualFrame(job.visual.image, job.profile, background) : null;

  // 7. Audio: music (faded) + optionally the looped original video sound; resampled like moviepy.
  const bitrate = videoBitrate(size, job.fps, job.quality);
  const audioChoice = await pickAudioCodec(job.audioBitrate, cb.warn);
  const fade = fadeLength(actualDuration);
  const musicFrames = Math.round(actualDuration * snippet.sampleRate);
  let music: Float32Array[] = snippet.channels.map((c) => c.slice(0, musicFrames));
  if (job.audioFade) applyAudioFade(music, musicFrames, snippet.sampleRate, fade);
  music = resample(music, snippet.sampleRate, audioChoice.sampleRate);
  if (job.visual.kind === "video" && !job.muteOriginalVideoAudio) {
    const original = await decodeAudio(job.visual.file).catch(() => null);
    if (original) {
      const looped = loopTo(resample(original.channels, original.sampleRate, audioChoice.sampleRate), music[0]!.length);
      music = music.map((plane, c) => plane.map((v, i) => Math.max(-1, Math.min(1, v + looped[c]![i]!))));
    }
  }

  // 8. Encoders + muxer.
  const videoCodec = await pickVideoCodec(size, bitrate, cb.warn);
  const renderer = createFrameRenderer(size, background, overlay, cb.warn);
  const canvas = renderer.canvas;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, {
    codec: videoCodec,
    bitrate,
    bitrateMode: "variable",
    latencyMode: "quality",
    keyFrameInterval: 2,
  });
  const audioSource = new AudioSampleSource({ codec: audioChoice.codec, bitrate: job.audioBitrate });
  output.addVideoTrack(videoSource, { frameRate: job.fps });
  output.addAudioTrack(audioSource);
  const frameCount = frameCountFor(actualDuration, job.fps);
  const times = Array.from({ length: frameCount }, (_, i) => i / job.fps);
  const visual = job.visual.image ? null : await openVideoFrames(job.visual.file, size, job.profile, background, times);
  try {
    await output.start();
    const frames = music[0]!.length;
    const planar = new Float32Array(frames * 2);
    planar.set(music[0]!, 0);
    planar.set(music[1] ?? music[0]!, frames);
    const sample = new AudioSample({ data: planar, format: "f32-planar", numberOfChannels: 2, sampleRate: audioChoice.sampleRate, timestamp: 0 });
    await audioSource.add(sample);
    sample.close();
    audioSource.close();

    // 6. Per frame: cancel check → visual → cascade (+ bass strength) → video fade → encode.
    for (let i = 0; i < frameCount; i++) {
      if (cb.cancelled()) throw new CancelledError();
      const t = times[i]!;
      const frame = stillFrame ?? (await visual!.next());
      renderer.render(frame, {
        time: t,
        settings: job.effects,
        bassStrength: envelope ? envelopeAt(envelope, t, job.fps) : null,
        fadeGain: job.videoFade ? videoFadeGain(t, actualDuration, fade) : 1,
      });
      await videoSource.add(t, 1 / job.fps);
      if (i % 6 === 0) onFraction(i / frameCount);
    }
    videoSource.close();
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  } finally {
    visual?.dispose();
    renderer.dispose();
  }

  // 9. Write to the sink (removed by the caller on failure).
  const writable = await sink.create(name);
  const writer = writable.getWriter();
  await writer.write(new Uint8Array(output.target.buffer!));
  await writer.close();
}

async function videoSize(file: File): Promise<Size> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(`${file.name} contains no usable video.`);
    return [track.displayWidth, track.displayHeight];
  } finally {
    input.dispose();
  }
}

/**
 * Frames of a video visual at `t mod duration`, fitted to the canvas. Contain-fit uses the
 * GPU/2D scaler rather than Pillow per frame (a documented, visual-only deviation).
 */
async function openVideoFrames(file: File, size: Size, profile: Size | null, background: Image8, times: number[]) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  const duration = await input.computeDuration();
  if (!track || !(duration > 0)) {
    input.dispose();
    throw new Error(`${file.name} contains no usable video.`);
  }
  const [w, h] = size;
  let box: [number, number, number, number] = [0, 0, track.displayWidth, track.displayHeight];
  if (profile) {
    const scale = Math.min(w / track.displayWidth, h / track.displayHeight);
    const cw = Math.max(1, Math.round(track.displayWidth * scale));
    const ch = Math.max(1, Math.round(track.displayHeight * scale));
    box = [Math.floor((w - cw) / 2), Math.floor((h - ch) / 2), cw, ch];
  }
  const sink = new CanvasSink(track, { width: box[2], height: box[3], fit: "fill", poolSize: 2 });
  const composite = new OffscreenCanvas(w, h).getContext("2d")!;
  const bg = new ImageData(w, h);
  for (let p = 0; p < w * h; p++) {
    bg.data.set(background.data.subarray(p * 3, p * 3 + 3), p * 4);
    bg.data[p * 4 + 3] = 255;
  }
  // Every frame's time is known up front: `t mod duration` loops the clip, and a sorted run
  // of timestamps decodes each packet at most once.
  const frames = sink.canvasesAtTimestamps(times.map((t) => t % duration));
  return {
    async next(): Promise<OffscreenCanvas> {
      const wrapped = (await frames.next()).value;
      composite.putImageData(bg, 0, 0);
      if (wrapped) composite.drawImage(wrapped.canvas as CanvasImageSource, box[0], box[1]);
      return composite.canvas;
    },
    dispose() {
      void frames.return(undefined);
      input.dispose();
    },
  };
}

type FrameRenderer = {
  canvas: OffscreenCanvas;
  render: (frame: Image8 | OffscreenCanvas, options: FrameOptions) => void;
  dispose: () => void;
};

/**
 * WebGL2 on an OffscreenCanvas when the Worker has it; otherwise the bit-exact CPU reference
 * (much slower). WebKitGTK and older Safari lack WebGL in Workers.
 */
function createFrameRenderer(size: Size, background: Image8, overlay: Image8 | null, warn: PromoCallbacks["warn"]): FrameRenderer {
  const [w, h] = size;
  try {
    const canvas = new OffscreenCanvas(w, h);
    const gl = new GlEffectRenderer(canvas, w, h);
    gl.setBackground(background);
    gl.setOverlay(overlay);
    return { canvas, render: (frame, options) => gl.render(frame, options), dispose: () => gl.dispose() };
  } catch (error) {
    if (!(error instanceof WebGLUnavailableError)) throw error;
  }
  warn("GPU effects aren't available in this browser's background workers, so rendering uses the CPU (slower).");
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  const out = new ImageData(w, h);
  const readCanvas = (source: OffscreenCanvas): Image8 => {
    const rgba = source.getContext("2d")!.getImageData(0, 0, w, h).data;
    return dropAlpha({ width: w, height: h, channels: 4, data: new Uint8Array(rgba.buffer) });
  };
  return {
    canvas,
    render(frame, options) {
      const rgb = frame instanceof OffscreenCanvas ? readCanvas(frame) : frame.channels === 3 ? frame : dropAlpha(frame);
      let result = applyEffectChain(rgb, options.time, options.settings, background, options.bassStrength, overlay);
      result = applyVideoFade(result, options.fadeGain ?? 1);
      for (let p = 0; p < w * h; p++) {
        out.data[p * 4] = result.data[p * 3]!;
        out.data[p * 4 + 1] = result.data[p * 3 + 1]!;
        out.data[p * 4 + 2] = result.data[p * 3 + 2]!;
        out.data[p * 4 + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
    },
    dispose() {},
  };
}
