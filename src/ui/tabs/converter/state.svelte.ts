/**
 * Media Converter tab state (spec 06). Module-level so it survives switching tabs. Pure rules
 * live in `engine/converter.ts`. Desktop persists nothing here but History.
 */
import {
  CONVERT_PROGRESS,
  DEFAULT_MP3_BITRATE,
  MP3_BITRATES,
  detectBatch,
  finishedConversions,
  formatsFor,
  keepFormat,
  type BatchState,
  type Mp3Bitrate,
  type OutputFormatName,
} from "../../../engine/converter";
import { reselectNames } from "../../../engine/history";
import { AUDIO_OUTPUT_FORMATS, VIDEO_OUTPUT_FORMATS } from "../../../engine/media-kind";
import { trackIdentity, type FileRef } from "../../../io/file-ref";
import { isFolderRef } from "../../../io/history-outputs";
import { deliverStaged } from "../../../io/deliver";
import { probeSource } from "../../../io/media-probe";
import { prepareStaging } from "../../../io/retention";
import type { OutputRef } from "../../../io/sink";
import { addHistory, historyId, localTimestamp } from "../../../storage/history";
import type { ToolRequest, Undecodable } from "../../../workers/render-protocol";
import { decodeAtNativeRate } from "../../../workers/media-client";
import { jobRecorded } from "../../history.svelte";
import { historyOutputs, notifyFinished, runJob } from "../../job-runner";
import { OutputFolder } from "../../output-folder.svelte";
import { app } from "../../state.svelte";

export type BatchFile = { key: string; file: File; ok: boolean | null };

class ConverterState {
  files = $state<BatchFile[]>([]);
  selected = $state<string[]>([]);
  format = $state<OutputFormatName | null>(null);
  bitrate = $state<Mp3Bitrate>(DEFAULT_MP3_BITRATE);
  readonly folder = new OutputFolder("mm-converter-export");

  running = $state(false);
  cancelling = $state(false);
  progress = $state<{ percent: number; status: string } | null>(null);
  /** Files named by Load Job that the user still has to pick (files aren't persisted). */
  pendingNames = $state<string[]>([]);
  /** The last finished job's History id (the progress label links to it). */
  lastJobId = $state<string | null>(null);
  warnings = $state<string[]>([]);
  failure = $state<{ message: string; details: string } | null>(null);

  private worker: Worker | null = null;
  private restored = false;

  get batch(): BatchState {
    return detectBatch(this.files.map((f) => ({ name: f.file.name, ok: f.ok })));
  }

  /** Add files (desktop replaces the list on each pick; the web adds, and dedupes). */
  add(files: File[]): void {
    const known = new Set(this.files.map((f) => f.key));
    const added = files.filter((file) => !known.has(trackIdentity(file))).map((file) => ({ key: trackIdentity(file), file, ok: null as boolean | null }));
    this.files = [...this.files, ...added];
    if (added.length) this.pendingNames = [];
    for (const entry of added) {
      void probeSource(entry.file).then((probe) => {
        const row = this.files.find((f) => f.key === entry.key);
        if (row) row.ok = probe.ok;
        this.syncFormat();
      });
    }
    this.syncFormat();
  }

  removeSelected(): void {
    const drop = new Set(this.selected);
    this.files = this.files.filter((f) => !drop.has(f.key));
    this.selected = [];
    this.syncFormat();
  }

  /** Keep the chosen format while it's still offered, else the first usable one. */
  private syncFormat(): void {
    const batch = this.batch;
    // While new files are being probed (or none are picked yet, e.g. after Load Job), keep the choice.
    if ("error" in batch && (batch.error === "checking" || batch.error === "empty")) return;
    this.format = keepFormat(this.format, formatsFor("kind" in batch ? batch.kind : null));
  }

  restore(): void {
    if (this.restored || !app.settingsLoaded) return;
    this.restored = true;
    void this.folder.set(app.settings["general/default_output"]);
  }

  async convert(): Promise<void> {
    const batch = this.batch;
    if (this.running || !("kind" in batch) || !this.format) return;
    const sources = this.files.map((f) => f.file);
    const format = this.format;
    const bitrate = this.bitrate;
    this.running = true;
    this.cancelling = false;
    this.failure = null;
    this.warnings = [];
    this.progress = { percent: 0, status: CONVERT_PROGRESS.preparing };
    const s = app.settings;
    const jobId = historyId();
    const tier1 = !!app.capabilities?.directoryPicker;
    await prepareStaging(s["web/keep_output_copies"]).catch(() => {});
    try {
      const handle = tier1 ? await this.folder.current() : null;
      if (tier1 && !handle) throw new Error("Choose a writable export folder.");
      const destination = handle ? ({ kind: "directory", handle } as const) : ({ kind: "staging", jobId } as const);
      const job = { sources, format, bitrate, conflict: s["general/conflict_policy"] };
      const outputs: OutputRef[] = [];
      let request: ToolRequest = { type: "start", job: { tool: "convert", job }, destination };
      // Files whose audio the Worker can't decode are decoded here and the job resumes there.
      for (;;) {
        try {
          const done = await this.runWorker(request);
          if (done === null) {
            this.progress = { percent: this.progress?.percent ?? 0, status: CONVERT_PROGRESS.cancelled };
            return;
          }
          outputs.push(...done);
          break;
        } catch (error) {
          const info = (error as { undecodable?: Undecodable }).undecodable;
          if (!info || info.index === undefined) throw error;
          outputs.push(...(info.outputs ?? []));
          const pcm = await decodeAtNativeRate(sources[info.index]!, info.sampleRate, info.numberOfChannels).catch(() => {
            throw error;
          });
          if (this.cancelling) {
            this.progress = { percent: this.progress?.percent ?? 0, status: CONVERT_PROGRESS.cancelled };
            return;
          }
          request = { type: "start", job: { tool: "convert", job: { ...job, from: info.index, pcm } }, destination };
        }
      }
      // Staged copies stay until the next job or app load: deleting them now would cancel the download.
      if (!handle && outputs.length) await deliverStaged(outputs, { zip: s["web/zip_batches"], tool: "Media Converter" });
      await this.record(jobId, sources, format, bitrate, outputs, !!handle);
      this.progress = { percent: 100, status: finishedConversions(outputs.length) };
      notifyFinished("Conversion", outputs.length);
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

  private runWorker(request: ToolRequest): Promise<OutputRef[] | null> {
    this.worker?.terminate();
    const worker = new Worker(new URL("../../../workers/job.worker.ts", import.meta.url), { type: "module", name: "job" });
    this.worker = worker;
    return runJob(worker, request, {
      progress: (percent, status) => {
        if (!this.cancelling) this.progress = { percent, status };
      },
      warn: (message) => {
        if (!this.warnings.includes(message)) this.warnings = [...this.warnings, message];
      },
      cancelled: () => this.cancelling,
    });
  }

  /** Works before the worker exists too: the job forwards it as soon as it starts. */
  cancel(): void {
    if (!this.running || this.cancelling) return;
    this.cancelling = true;
    if (this.progress) this.progress = { ...this.progress, status: CONVERT_PROGRESS.cancelling };
    this.worker?.postMessage({ type: "cancel" } satisfies ToolRequest);
  }

  private async record(id: string, sources: File[], format: string, bitrate: string, outputs: OutputRef[], directory: boolean) {
    const ref = (f: File) => ({ name: f.name, size: f.size, lastModified: f.lastModified });
    try {
      await addHistory({
        id,
        tool: "converter",
        created: localTimestamp(),
        source: ref(sources[0]!),
        sources: sources.map(ref),
        output: directory ? ($state.snapshot(this.folder.ref) as FileRef | null) : { name: "Downloads" },
        format,
        bitrate,
        outputs: historyOutputs(outputs),
      });
      this.lastJobId = id;
      jobRecorded(id);
    } catch {
      // History is best effort (storage may be unavailable).
    }
  }

  /** Load Job (spec 07): format, bitrate and export folder; the files are named for re-selection. */
  loadFromHistory(record: Record<string, unknown>): void {
    if (this.running) return;
    // The loaded job supersedes the one-time restore from Settings.
    this.restored = true;
    this.clear();
    const all = [...AUDIO_OUTPUT_FORMATS, ...VIDEO_OUTPUT_FORMATS] as readonly string[];
    if (typeof record.format === "string" && all.includes(record.format)) this.format = record.format as OutputFormatName;
    if ((MP3_BITRATES as readonly unknown[]).includes(record.bitrate)) this.bitrate = record.bitrate as Mp3Bitrate;
    if (isFolderRef(record.output)) void this.folder.set(record.output);
    this.pendingNames = reselectNames(record);
  }

  /** Clear: files, format/bitrate back to defaults, export folder to the Settings default. */
  clear(): void {
    if (this.running) return;
    this.progress = null;
    this.warnings = [];
    this.files = [];
    this.selected = [];
    this.pendingNames = [];
    this.format = null;
    this.bitrate = DEFAULT_MP3_BITRATE;
    void this.folder.set(app.settings["general/default_output"]);
  }
}

export const converter = new ConverterState();
