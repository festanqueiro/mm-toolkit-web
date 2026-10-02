/**
 * Video Creator tab state (spec 04). Module-level so it survives switching tabs.
 * Pure rules live in `engine/video-creator.ts`; this file wires them to files, the media
 * Worker and Web Audio.
 */
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
  TIMESTAMPS_HINT,
  type TrackRow,
} from "../../../engine/video-creator";
import { trackIdentity } from "../../../io/file-ref";
import type { Picked } from "../../../io/pick";
import { probeVisual, type VisualProbe } from "../../../io/visual";
import { decodeAudioFile, detectDrop } from "../../../workers/media-client";
import { app, updateSetting } from "../../state.svelte";

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
}

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
