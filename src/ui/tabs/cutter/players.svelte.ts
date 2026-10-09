/**
 * Media Cutter preview players (spec 05 "Preview playability"). The native `<video>`/`<audio>`
 * element comes first; when it can't play the source, audio falls back to a waveform with
 * chunked Web Audio playback, and video to WebCodecs frames on a canvas that follow the same
 * clock. Nothing holds the whole file: audio is decoded in short spans around the playhead.
 */
import { ALL_FORMATS, BlobSource, CanvasSink, Input, type WrappedCanvas } from "mediabunny";
import { audioPeaks, decodeAudioFile } from "../../../workers/media-client";

export type PlayerMode = "native" | "waveform" | "frames";

export interface PreviewPlayer {
  readonly mode: PlayerMode;
  /** Seconds; updated while playing (animation-frame rate) and on seek. */
  readonly position: number;
  readonly duration: number;
  readonly playing: boolean;
  /** The exact playhead now (for stopping a clip preview right at its end). */
  now(): number;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  destroy(): void;
}

/** The browser's own element. */
export class NativePlayer implements PreviewPlayer {
  readonly mode = "native";
  position = $state(0);
  duration = $state(0);
  playing = $state(false);
  private readonly off: () => void;

  constructor(private readonly element: HTMLMediaElement) {
    const on: [string, () => void][] = [
      ["loadedmetadata", () => (this.duration = element.duration)],
      ["timeupdate", () => (this.position = element.currentTime)],
      ["play", () => (this.playing = true)],
      ["pause", () => (this.playing = false)],
    ];
    for (const [type, handler] of on) element.addEventListener(type, handler);
    this.off = () => on.forEach(([type, handler]) => element.removeEventListener(type, handler));
    if (element.readyState >= 1) this.duration = element.duration;
  }

  now(): number {
    return this.element.currentTime;
  }

  async play(): Promise<void> {
    await this.element.play().catch(() => {});
  }

  pause(): void {
    this.element.pause();
  }

  seek(seconds: number): void {
    this.element.currentTime = seconds;
    this.position = seconds;
  }

  destroy(): void {
    this.off();
    this.element.pause();
  }
}

/** Seconds of audio decoded per chunk, and how far ahead the next chunk is prepared. */
const CHUNK = 10;
const LEAD = 4;

/**
 * Plays a file's audio from any position by decoding short spans in the media Worker and
 * scheduling them back to back. Follows the AudioContext clock, or wall time when that clock
 * doesn't move (no output device, e.g. headless or muted systems).
 */
class ChunkedAudio {
  private context: AudioContext | null = null;
  private session = 0;
  private sources: AudioBufferSourceNode[] = [];
  private from = 0;
  private t0 = 0;
  private wall0 = 0;
  private stalled = false;
  /** False once a decode fails: play silently on wall time. */
  private audible = true;

  constructor(
    private readonly file: Blob,
    private readonly duration: () => number,
  ) {}

  /** Start at `from`; resolves once playback has begun (first chunk scheduled). */
  async start(from: number): Promise<void> {
    this.stop();
    const session = ++this.session;
    this.from = from;
    this.stalled = false;
    if (this.audible) {
      try {
        this.context ??= new AudioContext();
        // `resume()` can stay pending forever without an output device; don't wait on it.
        if (this.context.state === "suspended") await Promise.race([this.context.resume(), new Promise((r) => setTimeout(r, 300))]);
        const first = await decodeAudioFile(this.file, { start: from, duration: CHUNK });
        if (session !== this.session) return;
        this.t0 = this.context.currentTime + 0.05;
        this.wall0 = performance.now() / 1000 + 0.05;
        this.schedule(first, this.t0);
        void this.feed(session, from + first.channels[0]!.length / first.sampleRate, this.t0 + first.channels[0]!.length / first.sampleRate);
        return;
      } catch {
        this.audible = false;
      }
    }
    this.stalled = true;
    this.wall0 = performance.now() / 1000;
  }

  /** Decode and schedule the following chunks while this session lasts. */
  private async feed(session: number, at: number, when: number): Promise<void> {
    const context = this.context!;
    while (session === this.session && at < this.duration() - 1e-3) {
      // Wait until the scheduled audio runs low (on wall time when the audio clock is stalled).
      const clock = () => (this.stalled ? this.t0 + (performance.now() / 1000 - this.wall0) : context.currentTime);
      while (session === this.session && when - clock() > LEAD) await new Promise((r) => setTimeout(r, 250));
      if (session !== this.session) return;
      let pcm;
      try {
        pcm = await decodeAudioFile(this.file, { start: at, duration: CHUNK });
      } catch {
        return;
      }
      const length = pcm.channels[0]!.length;
      if (!length || session !== this.session) return;
      this.schedule(pcm, when);
      at += length / pcm.sampleRate;
      when += length / pcm.sampleRate;
    }
  }

  private schedule(pcm: { sampleRate: number; channels: Float32Array[] }, when: number): void {
    const context = this.context!;
    const length = pcm.channels[0]!.length;
    if (!length) return;
    const buffer = context.createBuffer(pcm.channels.length, length, pcm.sampleRate);
    pcm.channels.forEach((plane, c) => buffer.copyToChannel(plane as Float32Array<ArrayBuffer>, c));
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(when);
    source.onended = () => (this.sources = this.sources.filter((s) => s !== source));
    this.sources.push(source);
  }

  /** The playhead in source seconds. */
  now(): number {
    const wall = performance.now() / 1000 - this.wall0;
    if (!this.stalled && this.context && wall > 0.5 && this.context.currentTime <= this.t0) this.stalled = true;
    return this.from + Math.max(0, this.stalled || !this.context ? wall : this.context.currentTime - this.t0);
  }

  stop(): void {
    this.session++;
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Not started yet or already stopped.
      }
    }
    this.sources = [];
  }

  dispose(): void {
    this.stop();
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}

/** Base for the fallbacks: a playhead driven by `ChunkedAudio` on animation frames. */
abstract class ClockPlayer implements PreviewPlayer {
  abstract readonly mode: PlayerMode;
  position = $state(0);
  duration = $state(0);
  playing = $state(false);
  protected readonly audio: ChunkedAudio;
  private frame = 0;

  constructor(file: Blob) {
    this.audio = new ChunkedAudio(file, () => this.duration);
  }

  now(): number {
    return this.playing ? Math.min(this.duration, this.audio.now()) : this.position;
  }

  async play(): Promise<void> {
    if (this.playing) return;
    if (this.position >= this.duration) this.position = 0;
    this.playing = true;
    await this.audio.start(this.position);
    const tick = () => {
      if (!this.playing) return;
      this.position = this.now();
      this.onTick?.(this.position);
      if (this.position >= this.duration) {
        this.pause();
        return;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  pause(): void {
    if (this.playing) this.position = this.now();
    this.playing = false;
    cancelAnimationFrame(this.frame);
    this.audio.stop();
  }

  seek(seconds: number): void {
    const wasPlaying = this.playing;
    this.pause();
    this.position = Math.max(0, Math.min(this.duration, seconds));
    this.onSeek?.(this.position);
    if (wasPlaying) void this.play();
  }

  destroy(): void {
    this.pause();
    this.audio.dispose();
  }

  /** Hooks for subclasses: the playhead moved while playing / by a seek. */
  protected onTick?(t: number): void;
  protected onSeek?(t: number): void;
}

/** Audio the element can't play: waveform peaks + chunked Web Audio. */
export class WaveformPlayer extends ClockPlayer {
  readonly mode = "waveform";
  peaks = $state.raw<Float32Array | null>(null);

  /** Resolves once the waveform is ready; rejects when the audio can't be decoded at all. */
  static async open(file: Blob, columns = 1200, onProgress?: (fraction: number) => void): Promise<WaveformPlayer> {
    const player = new WaveformPlayer(file);
    const { peaks, duration } = await audioPeaks(file, columns, true, onProgress);
    player.peaks = peaks;
    player.duration = duration;
    return player;
  }
}

/** Video the element can't play: decoded frames on a canvas, with the soundtrack when it decodes. */
export class FramePlayer extends ClockPlayer {
  readonly mode = "frames";
  private canvas: HTMLCanvasElement | null = null;
  private pending: number | null = null;
  private drawing = false;

  private constructor(
    file: Blob,
    private readonly input: Input,
    private readonly sink: CanvasSink,
    readonly width: number,
    readonly height: number,
  ) {
    super(file);
  }

  static async open(file: Blob): Promise<FramePlayer> {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) throw new Error("No decodable video track.");
      // Preview resolution: at most 640 px wide.
      const scale = Math.min(1, 640 / track.displayWidth);
      const width = Math.max(2, Math.round(track.displayWidth * scale));
      const height = Math.max(2, Math.round(track.displayHeight * scale));
      const player = new FramePlayer(file, input, new CanvasSink(track, { width, height, fit: "fill", poolSize: 2 }), width, height);
      player.duration = await input.computeDuration();
      return player;
    } catch (error) {
      input.dispose();
      throw error;
    }
  }

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    canvas.width = this.width;
    canvas.height = this.height;
    this.request(this.position);
  }

  protected override onTick(t: number): void {
    this.request(t);
  }

  protected override onSeek(t: number): void {
    this.request(t);
  }

  /** Draw the frame at `t`; while a decode is in flight only the latest request is kept. */
  private request(t: number): void {
    this.pending = t;
    if (this.drawing) return;
    this.drawing = true;
    void (async () => {
      while (this.pending !== null) {
        const at = this.pending;
        this.pending = null;
        let wrapped: WrappedCanvas | null = null;
        try {
          wrapped = await this.sink.getCanvas(Math.min(at, Math.max(0, this.duration - 1e-3)));
        } catch {
          // A frame that fails to decode just isn't drawn.
        }
        if (wrapped && this.canvas) this.canvas.getContext("2d")?.drawImage(wrapped.canvas as CanvasImageSource, 0, 0, this.width, this.height);
      }
      this.drawing = false;
    })();
  }

  override destroy(): void {
    super.destroy();
    this.input.dispose();
  }
}
