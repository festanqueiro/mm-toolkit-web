/**
 * Runtime capability detection (spec 01). Codec routing must depend on these
 * results, never on the browser's name.
 */

export type Capabilities = {
  webCodecs: boolean;
  h264Encode: boolean;
  aacEncode: boolean;
  opusEncode: boolean;
  webgl2: boolean;
  offscreenCanvas: boolean;
  directoryPicker: boolean;
  opfs: boolean;
  crossOriginIsolated: boolean;
  notifications: boolean;
  wakeLock: boolean;
};

/** H.264 High profile, level 4.0 — covers 1080p at up to 30 fps. */
export const H264_1080P = "avc1.640028";

async function videoEncodeSupported(codec: string): Promise<boolean> {
  if (typeof VideoEncoder === "undefined") return false;
  try {
    const { supported } = await VideoEncoder.isConfigSupported({
      codec,
      width: 1080,
      height: 1920,
      bitrate: 8_000_000,
      framerate: 24,
    });
    return supported === true;
  } catch {
    return false;
  }
}

async function audioEncodeSupported(codec: string, bitrate: number): Promise<boolean> {
  if (typeof AudioEncoder === "undefined") return false;
  try {
    const { supported } = await AudioEncoder.isConfigSupported({ codec, sampleRate: 48_000, numberOfChannels: 2, bitrate });
    return supported === true;
  } catch {
    return false;
  }
}

function webgl2Supported(): boolean {
  try {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(1, 1).getContext("webgl2") !== null;
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

export async function detectCapabilities(): Promise<Capabilities> {
  const [h264Encode, aacEncode, opusEncode] = await Promise.all([
    videoEncodeSupported(H264_1080P),
    audioEncodeSupported("mp4a.40.2", 192_000),
    audioEncodeSupported("opus", 192_000),
  ]);
  return {
    webCodecs: typeof VideoEncoder !== "undefined" && typeof AudioDecoder !== "undefined",
    h264Encode,
    aacEncode,
    opusEncode,
    webgl2: webgl2Supported(),
    offscreenCanvas: typeof OffscreenCanvas !== "undefined",
    directoryPicker: typeof globalThis.showDirectoryPicker === "function",
    opfs: typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function",
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    notifications: typeof Notification !== "undefined",
    wakeLock: typeof navigator !== "undefined" && "wakeLock" in navigator,
  };
}
