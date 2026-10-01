/** Message types between the Phase 0 spike page and its render worker. */

export type SpikeRequest = {
  type: "render";
  audio: File;
  image: File;
  width: number;
  height: number;
  fps: number;
  /** Snippet start within the track, seconds. */
  start: number;
  duration: number;
  /** Bits per pixel used to derive the video bitrate (spec 04 quality presets). */
  bpp: number;
  audioBitrate: number;
  bassBlur: boolean;
};

export type SpikeTimings = {
  decodeMs: number;
  analysisMs: number;
  renderEncodeMs: number;
  finalizeMs: number;
  totalMs: number;
};

export type SpikeResult = {
  type: "done";
  timings: SpikeTimings;
  frames: number;
  /** Frames per second achieved by the render+encode loop. */
  throughputFps: number;
  videoCodec: string;
  audioCodec: string;
  encoderConfig: VideoEncoderConfig | null;
  videoBitrate: number;
  bytes: number;
  sampleRate: number;
  file: Blob;
};

export type SpikeMessage =
  | { type: "progress"; percent: number; status: string }
  | SpikeResult
  | { type: "failed"; message: string; details: string };
