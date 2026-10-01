/// <reference lib="webworker" />
/**
 * Phase 0 spike (spec 14): WAV/any audio + image → WebGL2 bass-reactive radial blur
 * on an OffscreenCanvas → WebCodecs H.264 (fallback VP9/AV1) + AAC (fallback Opus)
 * → MP4 via Mediabunny. Measures where time goes. Not production code: the envelope
 * filter here is an approximation; the parity port lives in engine/analysis (Phase 1).
 */
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  canEncodeAudio,
  getFirstEncodableVideoCodec,
  type AudioCodec,
} from "mediabunny";
import type { SpikeMessage, SpikeRequest } from "./protocol";

const BLUR_SAMPLES = 6;
const MAX_ZOOM = 0.1;
const STRENGTH_FLOOR = 0.05;
const ENVELOPE_POWER = 1.6;
const FADE_S = 0.5;
const BACKGROUND: [number, number, number] = [25, 25, 29];

const post = (message: SpikeMessage) => self.postMessage(message);

self.onmessage = async (event: MessageEvent<SpikeRequest>) => {
  try {
    await render(event.data);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    post({ type: "failed", message: err.message, details: err.stack ?? "" });
  }
};

async function render(req: SpikeRequest): Promise<void> {
  const t0 = performance.now();

  // 1. Decode the snippet to planar float32 PCM at the file's native rate.
  post({ type: "progress", percent: 0, status: "Decoding audio" });
  const input = new Input({ source: new BlobSource(req.audio), formats: ALL_FORMATS });
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error(`${req.audio.name} contains no usable audio.`);
  const sampleRate = track.sampleRate;
  const channels = Math.min(2, track.numberOfChannels);
  const planes: Float32Array[] = [];
  const total = Math.floor(req.duration * sampleRate);
  for (let c = 0; c < channels; c++) planes.push(new Float32Array(total));
  let written = 0;
  for await (const sample of new AudioSampleSink(track).samples(req.start, req.start + req.duration)) {
    const offset = Math.max(0, Math.round((sample.timestamp - req.start) * sampleRate));
    const skip = Math.max(0, -offset);
    const count = Math.min(sample.numberOfFrames - skip, total - offset);
    if (count > 0) {
      for (let c = 0; c < channels; c++) {
        const tmp = new Float32Array(sample.numberOfFrames);
        sample.copyTo(tmp, { planeIndex: c, format: "f32-planar" });
        planes[c]!.set(tmp.subarray(skip, skip + count), offset);
      }
      written = Math.max(written, offset + count);
    }
    sample.close();
  }
  input.dispose();
  const frames = written;
  const actualDuration = frames / sampleRate;
  if (actualDuration <= 0) throw new Error(`${req.audio.name} contains no usable audio.`);
  const t1 = performance.now();

  // 2. Bass envelope (approximate low-pass; see file header) + audio fades.
  post({ type: "progress", percent: 2, status: "Analysing bass" });
  const frameCount = Math.max(1, Math.floor(actualDuration * req.fps));
  const envelope = req.bassBlur ? bassEnvelope(planes, frames, sampleRate, req.fps, frameCount) : null;
  applyAudioFade(planes, frames, Math.min(FADE_S, actualDuration / 2) * sampleRate);
  const t2 = performance.now();

  // 3. Base frame: contain-fit the image on the background (Lanczos comes later; canvas "high" here).
  const bitmap = await createImageBitmap(req.image);
  const base = new OffscreenCanvas(req.width, req.height);
  const ctx2d = base.getContext("2d")!;
  ctx2d.fillStyle = `rgb(${BACKGROUND.join(",")})`;
  ctx2d.fillRect(0, 0, req.width, req.height);
  const scale = Math.min(req.width / bitmap.width, req.height / bitmap.height);
  const dw = Math.round(bitmap.width * scale);
  const dh = Math.round(bitmap.height * scale);
  ctx2d.imageSmoothingQuality = "high";
  ctx2d.drawImage(bitmap, Math.floor((req.width - dw) / 2), Math.floor((req.height - dh) / 2), dw, dh);
  bitmap.close();

  // 4. Encoders + muxer.
  const videoBitrate = Math.round(req.width * req.height * req.fps * req.bpp);
  const videoCodec = await getFirstEncodableVideoCodec(["avc", "vp9", "av1"], {
    width: req.width,
    height: req.height,
    bitrate: videoBitrate,
  });
  if (!videoCodec) throw new Error("No supported video encoder (H.264/VP9/AV1) in this browser.");
  const audioCodec: AudioCodec = (await canEncodeAudio("aac", { numberOfChannels: channels, sampleRate, bitrate: req.audioBitrate }))
    ? "aac"
    : "opus";

  const gl = new GlBlur(req.width, req.height, base);
  let encoderConfig: VideoEncoderConfig | null = null;
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });
  const videoSource = new CanvasSource(gl.canvas, {
    codec: videoCodec,
    bitrate: videoBitrate,
    bitrateMode: "variable",
    latencyMode: "quality",
    keyFrameInterval: 2,
    onEncoderConfig: (config) => (encoderConfig = config),
  });
  const audioSource = new AudioSampleSource({ codec: audioCodec, bitrate: req.audioBitrate });
  output.addVideoTrack(videoSource, { frameRate: req.fps });
  output.addAudioTrack(audioSource);
  await output.start();

  // Audio first (small), so the muxer can interleave as video arrives.
  const planar = new Float32Array(frames * channels);
  for (let c = 0; c < channels; c++) planar.set(planes[c]!.subarray(0, frames), c * frames);
  const audioSample = new AudioSample({ data: planar, format: "f32-planar", numberOfChannels: channels, sampleRate, timestamp: 0 });
  await audioSource.add(audioSample);
  audioSample.close();
  audioSource.close();

  // 5. Render + encode loop.
  const fade = Math.min(FADE_S, actualDuration / 2);
  const t3 = performance.now();
  for (let i = 0; i < frameCount; i++) {
    const t = i / req.fps;
    const strength = envelope ? envelope[Math.min(i, envelope.length - 1)]! : 0;
    const fadeGain = Math.min(1, t / fade, (actualDuration - t) / fade);
    gl.draw(strength, Math.max(0, fadeGain));
    await videoSource.add(t, 1 / req.fps);
    if (i % req.fps === 0) {
      post({ type: "progress", percent: 5 + Math.round((i / frameCount) * 90), status: `Rendering frame ${i + 1} of ${frameCount}` });
    }
  }
  videoSource.close();
  const t4 = performance.now();
  post({ type: "progress", percent: 97, status: "Finalizing" });
  await output.finalize();
  const t5 = performance.now();

  const buffer = output.target.buffer!;
  post({
    type: "done",
    timings: { decodeMs: t1 - t0, analysisMs: t2 - t1, renderEncodeMs: t4 - t3, finalizeMs: t5 - t4, totalMs: t5 - t0 },
    frames: frameCount,
    throughputFps: frameCount / ((t4 - t3) / 1000),
    videoCodec,
    audioCodec,
    encoderConfig,
    videoBitrate,
    bytes: buffer.byteLength,
    sampleRate,
    file: new Blob([buffer], { type: "video/mp4" }),
  });
}

/** RBJ biquad low-pass (Q = 1/√2), applied twice ≈ 4th-order; forward-only (spike approximation). */
function lowpass(x: Float64Array, sampleRate: number, cutoff: number): Float64Array {
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  const b0 = (1 - cos) / 2 / a0;
  const b1 = (1 - cos) / a0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  let y = x;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float64Array(y.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let n = 0; n < y.length; n++) {
      const xn = y[n]!;
      const yn = b0 * xn + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = xn; y2 = y1; y1 = yn;
      out[n] = yn;
    }
    y = out;
  }
  return y;
}

function bassEnvelope(planes: Float32Array[], frames: number, sampleRate: number, fps: number, frameCount: number): Float32Array {
  const mono = new Float64Array(frames);
  for (const plane of planes) for (let n = 0; n < frames; n++) mono[n]! += plane[n]! / planes.length;
  const bass = lowpass(mono, sampleRate, 150);
  const window = Math.max(1, Math.floor(sampleRate / fps));
  const env = new Float32Array(frameCount);
  let peak = 0;
  for (let i = 0; i < frameCount; i++) {
    let sum = 0, count = 0;
    for (let n = i * window; n < Math.min((i + 1) * window, frames); n++, count++) sum += bass[n]! ** 2;
    env[i] = count ? Math.sqrt(sum / count) : 0;
    peak = Math.max(peak, env[i]!);
  }
  for (let i = 0; i < frameCount; i++) env[i] = Math.min(1, Math.max(0, peak > 0 ? env[i]! / peak : 0)) ** ENVELOPE_POWER;
  return env;
}

function applyAudioFade(planes: Float32Array[], frames: number, fadeSamples: number): void {
  if (fadeSamples <= 0) return;
  for (const plane of planes) {
    for (let n = 0; n < Math.min(fadeSamples, frames); n++) {
      plane[n]! *= n / fadeSamples;
      plane[frames - 1 - n]! *= n / fadeSamples;
    }
  }
}

/** Radial (zoom) blur: 6 progressively zoomed taps averaged, as in effects.apply_radial_blur. */
class GlBlur {
  readonly canvas: OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private uStrength: WebGLUniformLocation;
  private uFade: WebGLUniformLocation;

  constructor(width: number, height: number, base: OffscreenCanvas) {
    this.canvas = new OffscreenCanvas(width, height);
    const gl = this.canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false, alpha: false });
    if (!gl) throw new Error("WebGL2 is not available in this browser.");
    this.gl = gl;
    const program = link(gl, VERTEX, FRAGMENT);
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, base);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.uStrength = gl.getUniformLocation(program, "u_strength")!;
    this.uFade = gl.getUniformLocation(program, "u_fade")!;
    gl.viewport(0, 0, width, height);
  }

  draw(strength: number, fade: number): void {
    const gl = this.gl;
    gl.uniform1f(this.uStrength, strength <= STRENGTH_FLOOR ? 0 : strength);
    gl.uniform1f(this.uFade, fade);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

const VERTEX = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_image;
uniform float u_strength;
uniform float u_fade;
out vec4 outColor;
void main() {
  vec3 color;
  if (u_strength == 0.0) {
    color = texture(u_image, v_uv).rgb;
  } else {
    vec3 acc = vec3(0.0);
    for (int i = 1; i <= ${BLUR_SAMPLES}; i++) {
      float zoom = 1.0 + ${MAX_ZOOM.toFixed(2)} * u_strength * float(i) / ${BLUR_SAMPLES}.0;
      acc += texture(u_image, 0.5 + (v_uv - 0.5) / zoom).rgb;
    }
    color = acc / ${BLUR_SAMPLES}.0;
  }
  outColor = vec4(color * u_fade, 1.0);
}`;

function link(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Shader error");
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Link error");
  return program;
}
