/**
 * Live preview (spec 04, new): the visual with the full cascade, Layers and fades, at a
 * reduced size, playing along with a track's audio snippet. Effects run through the same
 * `GlEffectRenderer` as the render; bass strength comes from the precomputed snippet
 * envelope, so the preview pulses exactly like the output will.
 *
 * Layer compositing here uses the browser's 2D canvas scaling rather than the Pillow-exact
 * CPU path (fast at preview size, visually identical); pixel-exact fitting is the renderer's job.
 */
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import { envelopeAt } from "../../../engine/analysis/drop";
import type { Image8 } from "../../../engine/effects/cpu/image";
import { applyAudioFade, fadeLength, videoFadeGain } from "../../../engine/effects/fade";
import { GlEffectRenderer } from "../../../engine/effects/gl/renderer";
import type { EffectSettings, Rgb } from "../../../engine/effects/settings";
import type { Size } from "../../../engine/video-creator";

export type PreviewScene = {
  size: Size;
  /** Profile output: contain-fit on the background. Native: the visual fills the canvas. */
  fitted: boolean;
  backgroundColor: Rgb;
  backgroundImage: Image8 | null;
  overlay: Image8 | null;
  visual: { kind: "image"; file: File } | { kind: "video"; file: File; duration: number };
};

export type PreviewParams = {
  settings: EffectSettings;
  fps: number;
  videoFade: boolean;
  /** Envelope of the current snippet (null: bass blur gets no strength, like desktop without audio). */
  envelope: ArrayLike<number> | null;
  duration: number;
};

type Drawable = CanvasImageSource & { width: number; height: number };

const toCanvas = (image: Image8): OffscreenCanvas => {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const rgba = new ImageData(image.width, image.height);
  for (let p = 0; p < image.width * image.height; p++) {
    rgba.data[p * 4] = image.data[p * image.channels]!;
    rgba.data[p * 4 + 1] = image.data[p * image.channels + 1]!;
    rgba.data[p * 4 + 2] = image.data[p * image.channels + 2]!;
    rgba.data[p * 4 + 3] = image.channels === 4 ? image.data[p * 4 + 3]! : 255;
  }
  canvas.getContext("2d")!.putImageData(rgba, 0, 0);
  return canvas;
};

const readImage8 = (ctx: OffscreenCanvasRenderingContext2D, channels: 3 | 4): Image8 => {
  const { width, height } = ctx.canvas;
  const rgba = ctx.getImageData(0, 0, width, height).data;
  if (channels === 4) return { width, height, channels, data: new Uint8Array(rgba.buffer.slice(0)) };
  const data = new Uint8Array(width * height * 3);
  for (let p = 0; p < width * height; p++) data.set(rgba.subarray(p * 4, p * 4 + 3), p * 3);
  return { width, height, channels, data };
};

/** `ImageOps.contain` box (rounded like Pillow) centred in `size`. */
function containBox(src: { width: number; height: number }, [w, h]: Size): [number, number, number, number] {
  const scale = Math.min(w / src.width, h / src.height);
  const cw = Math.max(1, Math.round(src.width * scale));
  const ch = Math.max(1, Math.round(src.height * scale));
  return [Math.floor((w - cw) / 2), Math.floor((h - ch) / 2), cw, ch];
}

export class LivePreview {
  private canvas: HTMLCanvasElement;
  private renderer: GlEffectRenderer | null = null;
  private scene: PreviewScene | null = null;
  private composite: OffscreenCanvasRenderingContext2D | null = null;
  private backgroundCanvas: OffscreenCanvas | null = null;
  private stillVisual: ImageBitmap | null = null;
  private videoInput: Input | null = null;
  private videoSink: CanvasSink | null = null;
  private videoBox: [number, number, number, number] = [0, 0, 0, 0];
  private sceneToken = 0;
  private audio: AudioContext | null = null;
  private playback: { source: AudioBufferSourceNode; stopped: boolean; ended: boolean } | null = null;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "live-preview-canvas";
  }

  /** Put the preview canvas inside `container` (it's swapped in place when the size changes). */
  mount(container: HTMLElement): void {
    container.append(this.canvas);
  }

  get playing(): boolean {
    return this.playback !== null;
  }

  /** (Re)build layers for a new scene. Resolves false if a newer scene superseded it. */
  async setScene(scene: PreviewScene): Promise<boolean> {
    const token = ++this.sceneToken;
    this.stop();
    const [w, h] = scene.size;
    if (!this.renderer || this.renderer.width !== w || this.renderer.height !== h) {
      this.renderer?.dispose();
      // A lost context can't be revived on the same element: start from a fresh canvas.
      const fresh = document.createElement("canvas");
      fresh.className = this.canvas.className;
      this.canvas.replaceWith(fresh);
      this.canvas = fresh;
      this.renderer = new GlEffectRenderer(fresh, w, h);
    }

    // Background layer.
    const bg = new OffscreenCanvas(w, h);
    const bgCtx = bg.getContext("2d")!;
    if (scene.backgroundImage) {
      // `ImageOps.fit`: centred crop to the canvas ratio, then scale (cover).
      const src = toCanvas(scene.backgroundImage);
      const ratio = w / h;
      let sw = src.width;
      let sh = src.height;
      if (sw / sh >= ratio) sw = ratio * sh;
      else sh = sw / ratio;
      bgCtx.imageSmoothingQuality = "high";
      bgCtx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, w, h);
    } else {
      bgCtx.fillStyle = `rgb(${scene.backgroundColor.join(",")})`;
      bgCtx.fillRect(0, 0, w, h);
    }
    const background = readImage8(bgCtx, 3);

    // Overlay layer: contain-fit on transparent.
    let overlay: Image8 | null = null;
    if (scene.overlay) {
      const ov = new OffscreenCanvas(w, h);
      const ctx = ov.getContext("2d")!;
      const src = toCanvas(scene.overlay);
      const [x, y, cw, ch] = containBox(src, [w, h]);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src, x, y, cw, ch);
      overlay = readImage8(ctx, 4);
    }

    // Visual source.
    this.disposeVisual();
    let still: ImageBitmap | null = null;
    let input: Input | null = null;
    let sink: CanvasSink | null = null;
    let box: [number, number, number, number] = [0, 0, w, h];
    if (scene.visual.kind === "image") {
      still = await createImageBitmap(scene.visual.file, { imageOrientation: "none" as ImageOrientation });
      if (scene.fitted) box = containBox(still, [w, h]);
    } else {
      input = new Input({ source: new BlobSource(scene.visual.file), formats: ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error("No video track");
      if (scene.fitted) box = containBox({ width: track.displayWidth, height: track.displayHeight }, [w, h]);
      sink = new CanvasSink(track, { width: box[2], height: box[3], fit: "fill", poolSize: 2 });
    }
    if (token !== this.sceneToken) {
      still?.close();
      input?.dispose();
      return false;
    }
    this.scene = scene;
    this.backgroundCanvas = bg;
    this.renderer!.setBackground(background);
    this.renderer!.setOverlay(overlay);
    this.composite = new OffscreenCanvas(w, h).getContext("2d")!;
    this.composite.imageSmoothingQuality = "high";
    this.stillVisual = still;
    this.videoInput = input;
    this.videoSink = sink;
    this.videoBox = box;
    return true;
  }

  /** Draw the frame at `t` (seconds into the snippet) without playing. */
  async renderAt(t: number, params: PreviewParams): Promise<void> {
    const frame = await this.visualFrame(t);
    this.draw(frame, t, params);
  }

  /**
   * Play `pcm` (the snippet) from `from` seconds in, with frames following the audio clock.
   * Resolves when it ends or stops: true when it ran to the end of the snippet.
   */
  async play(
    pcm: { sampleRate: number; channels: Float32Array[] },
    params: PreviewParams,
    audioFade: boolean,
    from: number,
    onTime: (t: number) => void,
  ): Promise<boolean> {
    this.stop();
    if (!this.scene) return false;
    this.audio ??= new AudioContext();
    // `resume()` can stay pending forever without an output device; don't wait on it.
    if (this.audio.state === "suspended") await Promise.race([this.audio.resume(), new Promise((r) => setTimeout(r, 300))]);
    const frames = pcm.channels[0]!.length;
    const planes = pcm.channels.map((c) => c.slice());
    if (audioFade) applyAudioFade(planes, frames, pcm.sampleRate, fadeLength(params.duration));
    const buffer = this.audio.createBuffer(planes.length, Math.max(1, frames), pcm.sampleRate);
    planes.forEach((plane, c) => buffer.copyToChannel(plane as Float32Array<ArrayBuffer>, c));
    const source = this.audio.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audio.destination);
    const playback = { source, stopped: false, ended: false };
    this.playback = playback;
    const frameCount = Math.max(1, Math.floor(params.duration * params.fps));
    // Start on a frame boundary, so the picture and the sound leave from the same instant.
    const first = Math.min(frameCount - 1, Math.max(0, Math.floor(from * params.fps + 1e-6)));
    const offset = first / params.fps;
    const t0 = this.audio.currentTime + 0.05;
    source.start(t0, offset);
    source.onended = () => (playback.stopped = playback.ended = true);

    // Follow the audio clock. If it doesn't move (no output device, e.g. a headless or
    // muted system), fall back to wall time so the picture still plays.
    const audio = this.audio;
    const wallStart = performance.now() / 1000 + 0.05;
    let stalled = false;
    const clock = () => {
      const wall = performance.now() / 1000 - wallStart;
      if (!stalled && wall > 0.5 && audio.currentTime <= t0) stalled = true;
      return offset + (stalled ? wall : audio.currentTime - t0);
    };
    const nextPaint = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const visualDuration = this.scene.visual.kind === "video" ? this.scene.visual.duration : 0;
    const times = function* () {
      for (let i = first; i < frameCount; i++) yield visualDuration ? (i / params.fps) % visualDuration : 0;
    };
    const frames$ = this.videoSink ? this.videoSink.canvasesAtTimestamps(times()) : null;
    try {
      let i = first;
      for (; i < frameCount && !playback.stopped; i++) {
        const t = i / params.fps;
        const frame = frames$ ? ((await frames$.next()).value?.canvas as Drawable | undefined) ?? null : this.stillVisual;
        while (!playback.stopped && clock() < t) await nextPaint();
        if (playback.stopped) break;
        // Drop frames that are already a whole frame late, keep the clock.
        if (clock() - t > 1 / params.fps && i < frameCount - 1) continue;
        this.draw(frame, t, params);
        onTime(t);
      }
      return i >= frameCount || playback.ended;
    } finally {
      await frames$?.return(undefined);
      if (this.playback === playback) this.stop();
    }
  }

  stop(): void {
    const playback = this.playback;
    this.playback = null;
    if (!playback) return;
    playback.stopped = true;
    playback.source.onended = null;
    try {
      playback.source.stop();
    } catch {
      // Not started or already stopped.
    }
  }

  dispose(): void {
    this.stop();
    this.disposeVisual();
    this.renderer?.dispose();
    this.renderer = null;
    void this.audio?.close();
    this.audio = null;
  }

  private disposeVisual(): void {
    this.stillVisual?.close();
    this.stillVisual = null;
    this.videoInput?.dispose();
    this.videoInput = null;
    this.videoSink = null;
  }

  private async visualFrame(t: number): Promise<Drawable | null> {
    if (this.stillVisual) return this.stillVisual;
    if (!this.videoSink || this.scene?.visual.kind !== "video") return null;
    const wrapped = await this.videoSink.getCanvas(t % this.scene.visual.duration);
    return (wrapped?.canvas as Drawable | undefined) ?? null;
  }

  private draw(frame: Drawable | null, t: number, params: PreviewParams): void {
    if (!this.renderer || !this.composite || !this.scene || !this.backgroundCanvas) return;
    const ctx = this.composite;
    ctx.drawImage(this.backgroundCanvas, 0, 0);
    if (frame) {
      const [x, y, cw, ch] = this.videoBox;
      if (this.stillVisual) ctx.drawImage(frame, x, y, cw, ch);
      else ctx.drawImage(frame, x, y);
    }
    const strength = params.settings.bass_blur.enabled && params.envelope ? envelopeAt(params.envelope, t, params.fps) : null;
    const fadeGain = params.videoFade ? videoFadeGain(t, params.duration, fadeLength(params.duration)) : 1;
    this.renderer.render(ctx.canvas, { time: t, settings: params.settings, bassStrength: strength, fadeGain });
  }
}
