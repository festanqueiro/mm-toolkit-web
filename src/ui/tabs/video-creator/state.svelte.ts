/**
 * Video Creator tab state (spec 04). Module-level so it survives switching tabs.
 * Pure rules live in `engine/video-creator.ts`; this file wires them to files, the media
 * Worker and Web Audio.
 */
import type { Image8 } from "../../../engine/effects/cpu/image";
import { defaultEffectSettings, fromEffectsState, toEffectsState, type EffectSettings } from "../../../engine/effects/settings";
import type { PromoJob } from "../../../engine/render/promo";
import { formatTimestamp, parseTimestamp } from "../../../engine/time";
import {
  audioFilesFromFile,
  audioFilesInFolder,
  dropAnalysingStatus,
  dropFailedStatus,
  dropProposedStatus,
  mergeTrackRows,
  previewStatus,
  proposedStart,
  OUTPUT_DEFAULTS,
  PROFILES,
  trackOptions,
  TIMESTAMPS_HINT,
  type AudioBitrate,
  type Quality,
  type TrackRow,
} from "../../../engine/video-creator";
import { trackIdentity, type FileRef } from "../../../io/file-ref";
import { deliverStaged } from "../../../io/deliver";
import { decodeImage } from "../../../io/image-decode";
import { clearAllStaging, type OutputRef } from "../../../io/sink";
import { addHistory, historyId, localTimestamp } from "../../../storage/history";
import type { RenderRequest } from "../../../workers/render-protocol";
import type { Picked } from "../../../io/pick";
import { probeVisual, type VisualProbe } from "../../../io/visual";
import { decodeAudioFile, detectDrop } from "../../../workers/media-client";
import { historyOutputs, notifyFinished, runJob } from "../../job-runner";
import { OutputFolder } from "../../output-folder.svelte";
import { app, resetSettings, updateSetting } from "../../state.svelte";

export type AudioSelection = { label: string; folder: boolean; files: File[] };

class VideoCreatorState {
  audio = $state<AudioSelection | null>(null);
  rows = $state<TrackRow[]>([]);
  visualFile = $state.raw<File | null>(null);
  visual = $state<VisualProbe | null>(null);
  visualChecking = $state(false);
  timestampsStatus = $state("");
  analysingKey = $state<string | null>(null);
  previewKey = $state<string | null>(null);
  previewLoading = $state(false);
  /** Set when a job runs (render PR); disables inputs and stops previews. */
  running = $state(false);

  // Visual Effects + Layers (the effect stack's state, desktop `EffectsPanel`).
  effects = $state<EffectSettings>(defaultEffectSettings());
  /** Raw (not deeply reactive): holds decoded pixels. Replace the object to update. */
  layers = $state.raw<Record<LayerKind, LayerImage>>({ background: emptyLayer(), overlay: emptyLayer() });

  // Post-Effects.
  videoFade = $state(true);
  audioFade = $state(true);
  muteOriginal = $state(true);

  // Output.
  readonly folder = new OutputFolder("mm-promo-export");
  profile = $state(OUTPUT_DEFAULTS.profile);
  fps = $state(OUTPUT_DEFAULTS.fps);
  quality = $state<Quality>(OUTPUT_DEFAULTS.quality);
  audioBitrate = $state<AudioBitrate>(OUTPUT_DEFAULTS.audioBitrate);

  // Generation progress (footer). `status` is the desktop's progress label.
  progress = $state<{ percent: number; status: string; outputs: number } | null>(null);
  warnings = $state<string[]>([]);
  failure = $state<{ message: string; details: string } | null>(null);
  cancelling = $state(false);
  private worker: Worker | null = null;

  /** Registered by the live preview so a table ▶ stops it (only one audio preview at a time). */
  stopLivePreview: (() => void) | null = null;

  private restored = false;

  private filesByKey = new Map<string, File>();
  private player: AudioPreview | null = null;
  private visualToken = 0;

  get trackCount() {
    return this.rows.length;
  }

  fileFor(key: string): File | undefined {
    return this.filesByKey.get(key);
  }

  /** Apply a picked audio file or folder (`find_audio_files` semantics). */
  setAudio(picked: Picked): void {
    if (!picked.files.length && !picked.folder) return;
    this.stopPreview();
    const files = picked.folder
      ? audioFilesInFolder(picked.files.map((p) => ({ name: p.file.name, relativePath: p.relativePath, file: p.file }))).map((p) => p.file)
      : picked.files.flatMap((p) => audioFilesFromFile(p.file));
    const label = picked.folder ?? picked.files[0]?.file.name ?? "";
    this.audio = { label, folder: !!picked.folder, files };
    this.filesByKey = new Map(files.map((file) => [trackIdentity(file), file]));
    this.rows = mergeTrackRows(
      $state.snapshot(this.rows),
      files.map((file) => ({ key: trackIdentity(file), name: file.name })),
    );
    this.timestampsStatus = this.rows.length ? TIMESTAMPS_HINT : "";
  }

  /** Validate and thumbnail the visual; later picks win over slower earlier probes. */
  async setVisual(file: File | null): Promise<void> {
    const token = ++this.visualToken;
    if (this.visual?.ok) URL.revokeObjectURL(this.visual.thumbnail);
    this.visualFile = file;
    this.visual = null;
    if (!file) return;
    this.visualChecking = true;
    const probe = await probeVisual(file);
    if (token !== this.visualToken) {
      if (probe.ok) URL.revokeObjectURL(probe.thumbnail);
      return;
    }
    this.visual = probe;
    this.visualChecking = false;
  }

  updateRow(key: string, patch: Partial<Pick<TrackRow, "start" | "duration">>): void {
    const row = this.rows.find((r) => r.key === key);
    if (!row) return;
    Object.assign(row, patch);
    if (this.previewKey === key) this.stopPreview();
  }

  /** ✨: analyse one track and propose `max(0, drop − leadIn)` as its start. */
  async detectDrop(key: string, leadIn: number): Promise<void> {
    const file = this.filesByKey.get(key);
    if (!file || this.analysingKey) return;
    await updateSetting("promo/drop_lead_in", leadIn);
    this.analysingKey = key;
    this.timestampsStatus = dropAnalysingStatus(file.name);
    try {
      const drop = await detectDrop(file);
      const start = proposedStart(drop, leadIn);
      const row = this.rows.find((r) => r.key === key);
      if (row) row.start = formatTimestamp(start);
      this.timestampsStatus = dropProposedStatus(file.name, start);
    } catch (error) {
      this.timestampsStatus = dropFailedStatus(`${file.name} ${(error as Error).message}`);
    } finally {
      this.analysingKey = null;
    }
  }

  /** ▶/■: play `[start, start + duration)`; a second click on the playing row stops it. */
  async togglePreview(key: string): Promise<string | null> {
    if (this.previewKey === key) {
      this.stopPreview();
      return null;
    }
    const row = this.rows.find((r) => r.key === key);
    const file = this.filesByKey.get(key);
    if (!row || !file) return null;
    let start: number;
    try {
      start = parseTimestamp(row.start);
    } catch (error) {
      return (error as Error).message;
    }
    this.stopPreview();
    this.stopLivePreview?.();
    this.previewKey = key;
    this.previewLoading = true;
    this.timestampsStatus = previewStatus(file.name, start, row.duration);
    try {
      const pcm = await decodeAudioFile(file, { start, duration: row.duration });
      if (this.previewKey !== key) return null;
      this.player ??= new AudioPreview();
      await this.player.play(pcm, () => {
        if (this.previewKey === key) this.previewKey = null;
      });
    } catch (error) {
      if (this.previewKey === key) this.previewKey = null;
      return `${file.name} ${(error as Error).message}.`;
    } finally {
      this.previewLoading = false;
    }
    return null;
  }

  stopPreview(): void {
    this.previewKey = null;
    this.player?.stop();
  }

  get leadIn(): number {
    return app.settings["promo/drop_lead_in"];
  }

  /** Restore saved effects, fades and the export folder once settings have loaded (desktop restores on start). */
  restore(): void {
    if (this.restored || !app.settingsLoaded) return;
    this.restored = true;
    const s = app.settings;
    const raw = s["promo/effects_state"];
    if (raw) {
      try {
        this.effects = fromEffectsState(JSON.parse(raw));
        // Layer files aren't re-openable until input persistence lands; keep the settings, drop the refs.
        this.effects.overlay.mediaPath = null;
        this.effects.background.imagePath = null;
      } catch {
        // Malformed JSON: keep defaults (desktop ignores it too).
      }
    }
    this.videoFade = s["promo/video_fade"];
    this.audioFade = s["promo/audio_fade"];
    this.muteOriginal = s["promo/mute_original_video_audio"];
    void this.folder.set(s.output ?? s["general/default_output"]);
  }

  /** Decode a Background or Overlay image (Pillow-like: exact PNG bytes, no EXIF rotation). */
  async setLayerImage(kind: LayerKind, file: File | null): Promise<void> {
    const token = ++this.layerTokens[kind];
    this.layers = { ...this.layers, [kind]: { file, image: null, error: "", loading: !!file } };
    if (!file) return;
    try {
      const image = await decodeImage(file);
      if (token === this.layerTokens[kind]) this.layers = { ...this.layers, [kind]: { file, image, error: "", loading: false } };
    } catch {
      if (token === this.layerTokens[kind]) this.layers = { ...this.layers, [kind]: { file, image: null, error: "The selected image could not be read.", loading: false } };
    }
  }
  private layerTokens: Record<LayerKind, number> = { background: 0, overlay: 0 };

  /** Generate Video(s): build the job, run it in the render Worker, deliver, record History. */
  async generate(): Promise<void> {
    if (this.running || !this.visualFile || !this.visual?.ok) return;
    const { options, error } = trackOptions(this.rows);
    if (error || !options.length) return;
    this.stopPreview();
    this.stopLivePreview?.();
    this.running = true;
    this.cancelling = false;
    this.failure = null;
    this.warnings = [];
    this.progress = { percent: 0, status: "Preparing…", outputs: 0 };
    const s = app.settings;
    const effects = $state.snapshot(this.effects) as EffectSettings;
    // Desktop saves these when generation starts.
    void updateSetting("promo/effects_state", JSON.stringify(toEffectsState(effects)));
    void updateSetting("promo/video_fade", this.videoFade);
    void updateSetting("promo/audio_fade", this.audioFade);
    void updateSetting("promo/mute_original_video_audio", this.muteOriginal);
    if (this.folder.ref) void updateSetting("output", $state.snapshot(this.folder.ref) as FileRef);

    const jobId = historyId();
    const tier1 = !!app.capabilities?.directoryPicker;
    if (!s["web/keep_output_copies"]) await clearAllStaging().catch(() => {});
    try {
      const visual = this.visual;
      const job: PromoJob = {
        tracks: this.rows.map((row, i) => ({ file: this.filesByKey.get(row.key)!, start: options[i]!.start, duration: options[i]!.duration })),
        visual: { file: this.visualFile, kind: visual.kind, image: visual.kind === "image" ? await decodeImage(this.visualFile) : null },
        effects,
        backgroundImage: this.layers.background.image,
        overlayImage: this.layers.overlay.image,
        profile: PROFILES[this.profile]?.size ?? null,
        fps: this.fps,
        quality: this.quality,
        audioBitrate: parseInt(this.audioBitrate, 10) * 1000,
        videoFade: this.videoFade,
        audioFade: this.audioFade,
        muteOriginalVideoAudio: this.muteOriginal,
        naming: s["general/promo_naming"],
        conflict: s["general/conflict_policy"],
      };
      const handle = tier1 ? await this.folder.current() : null;
      if (tier1 && !handle) throw new Error("Choose a writable export folder.");
      const worker = new Worker(new URL("../../../workers/render.worker.ts", import.meta.url), { type: "module", name: "render" });
      this.worker = worker;
      const outputs = await runJob(worker, { type: "start", job, destination: handle ? { kind: "directory", handle } : { kind: "staging", jobId } } satisfies RenderRequest, {
        progress: (percent, status) => {
          if (!this.cancelling) this.progress = { percent, status, outputs: 0 };
        },
        warn: (message) => {
          if (!this.warnings.includes(message)) this.warnings = [...this.warnings, message];
        },
      });
      if (outputs === null) {
        this.progress = { percent: this.progress?.percent ?? 0, status: "Cancelled. Partial files were removed.", outputs: 0 };
        return;
      }
      // Staged copies stay until the next job or app load: deleting them now would cancel the download.
      if (!handle && outputs.length) await deliverStaged(outputs, { zip: s["web/zip_batches"], tool: "Video Creator" });
      await this.record(jobId, effects, options, outputs, !!handle);
      this.progress = { percent: 100, status: `Finished ${outputs.length} video${outputs.length === 1 ? "" : "s"}`, outputs: outputs.length };
      notifyFinished("Promo video", outputs.length);
    } catch (error) {
      const err = error as Error & { details?: string };
      this.failure = { message: err.message, details: err.details ?? err.stack ?? "" };
      this.progress = null;
    } finally {
      this.running = false;
      this.worker?.terminate();
      this.worker = null;
    }
  }

  cancel(): void {
    if (!this.worker || this.cancelling) return;
    this.cancelling = true;
    if (this.progress) this.progress = { ...this.progress, status: "Cancelling safely…" };
    this.worker.postMessage({ type: "cancel" } satisfies RenderRequest);
  }

  private async record(id: string, effects: EffectSettings, options: { start: number; duration: number }[], outputs: OutputRef[], directory: boolean) {
    const ref = (f: File | null | undefined) => (f ? { name: f.name, size: f.size, lastModified: f.lastModified } : null);
    try {
      await addHistory({
        id,
        tool: "promo",
        created: localTimestamp(),
        source: this.audio ? { name: this.audio.label, kind: this.audio.folder ? "directory" : "file" } : null,
        cover: ref(this.visualFile),
        output: directory ? $state.snapshot(this.folder.ref) : { name: "Downloads" },
        bass_effect: effects.bass_blur.enabled,
        effects: toEffectsState(effects),
        video_fade: this.videoFade,
        audio_fade: this.audioFade,
        mute_original_video_audio: this.muteOriginal,
        tracks: this.rows.map((row, i) => ({ path: ref(this.filesByKey.get(row.key)), start: options[i]!.start, duration: options[i]!.duration })),
        fps: this.fps,
        profile: PROFILES[this.profile]?.size ?? null,
        quality: this.quality,
        audio_bitrate: this.audioBitrate,
        outputs: historyOutputs(outputs),
      });
    } catch {
      // History is best effort (storage may be unavailable).
    }
  }

  /** Clear: inputs, effects and output back to defaults (desktop `clear`). The drop lead-in is kept. */
  clear(): void {
    if (this.running) return;
    this.progress = null;
    this.warnings = [];
    this.stopPreview();
    this.stopLivePreview?.();
    this.audio = null;
    this.rows = [];
    this.filesByKey = new Map();
    this.timestampsStatus = "";
    void this.setVisual(null);
    this.effects = defaultEffectSettings();
    void this.setLayerImage("background", null);
    void this.setLayerImage("overlay", null);
    this.videoFade = this.audioFade = this.muteOriginal = true;
    void this.folder.set(app.settings["general/default_output"]);
    this.profile = OUTPUT_DEFAULTS.profile;
    this.fps = OUTPUT_DEFAULTS.fps;
    this.quality = OUTPUT_DEFAULTS.quality;
    this.audioBitrate = OUTPUT_DEFAULTS.audioBitrate;
    void resetSettings(["music", "cover", "output", "promo/video_fade", "promo/audio_fade", "promo/mute_original_video_audio", "promo/effects_state"]);
  }
}

export type LayerKind = "background" | "overlay";
export type LayerImage = { file: File | null; image: Image8 | null; error: string; loading: boolean };
const emptyLayer = (): LayerImage => ({ file: null, image: null, error: "", loading: false });

/** Web Audio playback of a decoded snippet (sample-accurate, any decodable format). */
class AudioPreview {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;

  async play(pcm: { sampleRate: number; channels: Float32Array[] }, onEnded: () => void): Promise<void> {
    this.stop();
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();
    const length = pcm.channels[0]!.length;
    const buffer = this.context.createBuffer(pcm.channels.length, Math.max(1, length), pcm.sampleRate);
    pcm.channels.forEach((plane, c) => buffer.copyToChannel(plane as Float32Array<ArrayBuffer>, c));
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    source.onended = () => {
      if (this.source === source) this.source = null;
      onEnded();
    };
    this.source = source;
    source.start();
  }

  stop(): void {
    const source = this.source;
    this.source = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
  }
}

export const vc = new VideoCreatorState();
