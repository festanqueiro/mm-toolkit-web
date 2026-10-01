import "../ui/theme.css";
import "./spike.css";
import type { SpikeMessage, SpikeRequest, SpikeResult } from "./protocol";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** 16-bit stereo WAV: quiet hats/pad, then a pulsing bass "drop" at 45 s. */
function generatedWav(seconds = 100, sampleRate = 44_100, dropAt = 45): File {
  const frames = seconds * sampleRate;
  const buffer = new ArrayBuffer(44 + frames * 4);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + frames * 4, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, frames * 4, true);
  let seed = 1;
  const noise = () => ((seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let n = 0; n < frames; n++) {
    const t = n / sampleRate;
    const hats = Math.sin(2 * Math.PI * 4 * t) > 0.6 ? noise() * 0.05 : 0;
    const pad = 0.05 * Math.sin(2 * Math.PI * 440 * t);
    const pulse = Math.sin(2 * Math.PI * 2 * t) > 0 ? 1 : 0;
    const bass = t >= dropAt ? 0.6 * Math.sin(2 * Math.PI * 55 * t) * pulse : 0;
    const v = Math.max(-1, Math.min(1, hats + pad + bass));
    view.setInt16(44 + n * 4, v * 32767, true);
    view.setInt16(46 + n * 4, v * 0.9 * 32767, true);
  }
  return new File([buffer], "generated-track.wav", { type: "audio/wav" });
}

async function generatedImage(size = 1500): Promise<File> {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, "#6b4dff");
  gradient.addColorStop(1, "#ff5fa2");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 6;
  for (let r = 60; r < size / 2; r += 60) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${size / 10}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("MM", size / 2, size / 2 + size / 30);
  return new File([await canvas.convertToBlob({ type: "image/png" })], "generated-cover.png", { type: "image/png" });
}

function summary(result: SpikeResult, req: SpikeRequest): Record<string, unknown> {
  const t = result.timings;
  const seconds = (ms: number) => Math.round(ms) / 1000;
  return {
    userAgent: navigator.userAgent,
    profile: `${req.width}x${req.height}@${req.fps}`,
    snippetSeconds: req.duration,
    frames: result.frames,
    videoCodec: result.videoCodec,
    encoderCodecString: result.encoderConfig?.codec ?? null,
    hardwareAcceleration: result.encoderConfig?.hardwareAcceleration ?? "unknown",
    audioCodec: result.audioCodec,
    sampleRate: result.sampleRate,
    videoBitrateMbps: Math.round(result.videoBitrate / 10_000) / 100,
    outputMB: Math.round(result.bytes / 10_000) / 100,
    decodeS: seconds(t.decodeMs),
    analysisS: seconds(t.analysisMs),
    renderEncodeS: seconds(t.renderEncodeMs),
    finalizeS: seconds(t.finalizeMs),
    totalS: seconds(t.totalMs),
    throughputFps: Math.round(result.throughputFps * 10) / 10,
    realtimeFactor: Math.round((req.duration / (t.totalMs / 1000)) * 100) / 100,
  };
}

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const run = $<HTMLButtonElement>("run");
  const status = $("status");
  const progress = $<HTMLProgressElement>("progress");
  const resultEl = $("result");
  run.disabled = true;
  resultEl.hidden = true;
  $("download").hidden = true;
  $("video").hidden = true;
  progress.hidden = false;
  progress.value = 0;

  const generated = $<HTMLInputElement>("generated").checked;
  status.textContent = generated ? "Generating test media…" : "Preparing…";
  const audio = generated ? generatedWav() : $<HTMLInputElement>("audio").files?.[0];
  const image = generated ? await generatedImage() : $<HTMLInputElement>("image").files?.[0];
  if (!audio || !image) {
    status.textContent = "Choose an audio file and an image, or use generated test media.";
    run.disabled = false;
    progress.hidden = true;
    return;
  }
  const [width, height] = $<HTMLSelectElement>("profile").value.split("x").map(Number) as [number, number];
  const req: SpikeRequest = {
    type: "render",
    audio,
    image,
    width,
    height,
    fps: Number($<HTMLInputElement>("fps").value),
    start: Number($<HTMLInputElement>("start").value),
    duration: Number($<HTMLInputElement>("duration").value),
    bpp: Number($<HTMLSelectElement>("bpp").value),
    audioBitrate: Number($<HTMLSelectElement>("audioBitrate").value),
    bassBlur: $<HTMLInputElement>("bassBlur").checked,
  };

  const worker = new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (message: MessageEvent<SpikeMessage>) => {
    const data = message.data;
    if (data.type === "progress") {
      progress.value = data.percent;
      status.textContent = data.status;
      return;
    }
    worker.terminate();
    run.disabled = false;
    progress.hidden = true;
    if (data.type === "failed") {
      status.textContent = `Render failed: ${data.message}`;
      resultEl.textContent = JSON.stringify({ error: data.message, details: data.details, userAgent: navigator.userAgent }, null, 2);
      resultEl.hidden = false;
      return;
    }
    status.textContent = "✓ Done.";
    resultEl.textContent = JSON.stringify(summary(data, req), null, 2);
    resultEl.hidden = false;
    const url = URL.createObjectURL(data.file);
    const link = $<HTMLAnchorElement>("download");
    link.href = url;
    link.hidden = false;
    const video = $<HTMLVideoElement>("video");
    video.src = url;
    video.hidden = false;
  };
  worker.postMessage(req);
});
