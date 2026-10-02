/**
 * Video Creator tab state (spec 04). Module-level so it survives switching tabs.
 * Pure rules live in `engine/video-creator.ts`; this file wires them to files, the media
 * Worker and Web Audio.
 */
import type { Image8 } from "../../../engine/effects/cpu/image";
import { defaultEffectSettings, fromEffectsState, type EffectSettings } from "../../../engine/effects/settings";
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
  TIMESTAMPS_HINT,
  type AudioBitrate,
  type Quality,
  type TrackRow,
} from "../../../engine/video-creator";
import { fileRefFromHandle, forgetRef, handleFor, queryPermission, requestPermission, trackIdentity, type FileRef } from "../../../io/file-ref";
import { decodeImage } from "../../../io/image-decode";
import type { Picked } from "../../../io/pick";
import { probeVisual, type VisualProbe } from "../../../io/visual";
import { decodeAudioFile, detectDrop } from "../../../workers/media-client";
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
  output = $state<FileRef | null>(null);
  outputPermission = $state<PermissionState | "none">("none");
  profile = $state(OUTPUT_DEFAULTS.profile);
  fps = $state(OUTPUT_DEFAULTS.fps);
  quality = $state<Quality>(OUTPUT_DEFAULTS.quality);
  audioBitrate = $state<AudioBitrate>(OUTPUT_DEFAULTS.audioBitrate);

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
    this.output = s.output ?? s["general/default_output"];
    void this.refreshOutputPermission();
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

  /** Tier 1: pick a writable export folder (a persisted handle). */
  async chooseOutput(): Promise<void> {
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await showDirectoryPicker({ id: "mm-promo-export", mode: "readwrite" });
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return;
      throw error;
    }
    const previous = this.output;
    this.output = await fileRefFromHandle(handle);
    this.outputPermission = await queryPermission(handle, "readwrite");
    if (previous && previous.id !== app.settings["general/default_output"]?.id && previous.id !== app.settings.output?.id) await forgetRef(previous);
  }

  async reallowOutput(): Promise<void> {
    const handle = await handleFor(this.output);
    if (handle && (await requestPermission(handle, "readwrite"))) this.outputPermission = "granted";
  }

  async refreshOutputPermission(): Promise<void> {
    const handle = await handleFor(this.output);
    this.outputPermission = handle ? await queryPermission(handle, "readwrite") : "none";
  }

  /** Clear: inputs, effects and output back to defaults (desktop `clear`). The drop lead-in is kept. */
  clear(): void {
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
    this.output = app.settings["general/default_output"];
    void this.refreshOutputPermission();
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
