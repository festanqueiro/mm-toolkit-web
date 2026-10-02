/**
 * Stem Splitter tab state (spec 15). Module-level so it survives switching tabs. Rules live in
 * `engine/stems/rules.ts`; the separation runs in the job Worker.
 */
import { MP3_BITRATES, type Mp3Bitrate } from "../../../engine/converter";
import { HTDEMUCS, modelCached, type ModelDescriptor } from "../../../engine/stems/model";
import { DEFAULT_STEMS, orderStems, SOURCE_READY, STEM_CHOICES, STEM_FORMATS, STEM_PROGRESS, finishedStems, type StemChoice, type StemFormat } from "../../../engine/stems/rules";
import type { FileRef } from "../../../io/file-ref";
import { deliverStaged } from "../../../io/deliver";
import { isFolderRef, type AvailableOutput } from "../../../io/history-outputs";
import { probeSource } from "../../../io/media-probe";
import { prepareStaging } from "../../../io/retention";
import type { OutputRef } from "../../../io/sink";
import { addHistory, historyId, localTimestamp } from "../../../storage/history";
import type { ToolRequest, Undecodable } from "../../../workers/render-protocol";
import { decodeAtNativeRate } from "../../../workers/media-client";
import { jobRecorded } from "../../history.svelte";
import { historyOutputs, notifyFinished, runJob } from "../../job-runner";
import { jobResults, savedToLabel } from "../../job-results";
import { OutputFolder } from "../../output-folder.svelte";
import { app } from "../../state.svelte";

export type StemSource = { file: File; ok: boolean; message: string; checking: boolean };

/** Tests substitute a tiny stand-in model (`e2e/stems.spec.ts`); the app always uses HT-Demucs. */
const modelDescriptor = (): ModelDescriptor => (globalThis as { __MM_STEM_MODEL__?: ModelDescriptor }).__MM_STEM_MODEL__ ?? HTDEMUCS;

class StemSplitterState {
  source = $state.raw<StemSource | null>(null);
  stems = $state<StemChoice[]>([...DEFAULT_STEMS]);
  format = $state<StemFormat>("wav");
  bitrate = $state<Mp3Bitrate>("320k");
  readonly folder = new OutputFolder("mm-stems-export");
  /** The model is in Cache Storage (null while checking). */
  modelReady = $state<boolean | null>(null);
  /** Named by Load Job; the user picks it again. */
  pendingSource = $state<string | null>(null);

  running = $state(false);
  cancelling = $state(false);
  progress = $state<{ percent: number; status: string } | null>(null);
  /** The last finished job's History id (the progress label links to it). */
  lastJobId = $state<string | null>(null);
  warnings = $state<string[]>([]);
  failure = $state<{ message: string; details: string } | null>(null);
  /** The last job's stems, playable inline. */
  results = $state.raw<AvailableOutput[]>([]);
  savedTo = $state("");

  private worker: Worker | null = null;
  private token = 0;
  private restored = false;

  async setSource(file: File | null): Promise<void> {
    const token = ++this.token;
    if (!file) {
      this.source = null;
      return;
    }
    this.pendingSource = null;
    this.source = { file, ok: false, message: "", checking: true };
    const probe = await probeSource(file);
    if (token !== this.token) return;
    this.source = { file, ok: probe.ok, message: probe.ok ? SOURCE_READY : probe.message, checking: false };
  }

  toggleStem(stem: StemChoice, on: boolean): void {
    this.stems = orderStems(on ? [...this.stems, stem] : this.stems.filter((s) => s !== stem));
  }

  async refreshModel(): Promise<void> {
    this.modelReady = await modelCached(modelDescriptor());
  }

  restore(): void {
    if (this.restored || !app.settingsLoaded) return;
    this.restored = true;
    void this.folder.set(app.settings["general/default_output"]);
    void this.refreshModel();
  }

  async split(): Promise<void> {
    const source = this.source;
    if (this.running || !source?.ok || !this.stems.length) return;
    this.running = true;
    this.cancelling = false;
    this.failure = null;
    this.warnings = [];
    this.results = [];
    this.lastJobId = null;
    this.progress = { percent: 0, status: `Preparing ${source.file.name}…` };
    const s = app.settings;
    const jobId = historyId();
    const tier1 = !!app.capabilities?.directoryPicker;
    await prepareStaging(s["web/keep_output_copies"]).catch(() => {});
    try {
      const handle = tier1 ? await this.folder.current() : null;
      if (tier1 && !handle) throw new Error("Choose a writable export folder.");
      const destination = handle ? ({ kind: "directory", handle } as const) : ({ kind: "staging", jobId } as const);
      const job = {
        source: source.file,
        stems: $state.snapshot(this.stems) as StemChoice[],
        format: this.format,
        bitrate: this.bitrate,
        conflict: s["general/conflict_policy"],
        model: modelDescriptor(),
      };
      let outputs: OutputRef[] | null;
      try {
        outputs = await this.runWorker({ type: "start", job: { tool: "stems", job }, destination });
      } catch (error) {
        // The Worker can't decode this audio here: decode it on the page and retry from PCM.
        const info = (error as { undecodable?: Undecodable }).undecodable;
        if (!info) throw error;
        const pcm = await decodeAtNativeRate(source.file, info.sampleRate, info.numberOfChannels).catch(() => {
          throw error;
        });
        outputs = this.cancelling ? null : await this.runWorker({ type: "start", job: { tool: "stems", job: { ...job, pcm } }, destination });
      }
      void this.refreshModel();
      if (outputs === null) {
        this.progress = { percent: this.progress?.percent ?? 0, status: STEM_PROGRESS.cancelled };
        return;
      }
      const record = {
        id: jobId,
        tool: "stems" as const,
        created: localTimestamp(),
        source: { name: source.file.name, size: source.file.size, lastModified: source.file.lastModified },
        output: handle ? ($state.snapshot(this.folder.ref) as FileRef | null) : { name: "Downloads" },
        stems: job.stems,
        format: job.format,
        bitrate: job.bitrate,
        outputs: historyOutputs(outputs),
      };
      if (!handle && outputs.length) await deliverStaged(outputs, { zip: s["web/zip_batches"], tool: "Stem Splitter" });
      try {
        await addHistory(record);
        this.lastJobId = jobId;
        jobRecorded(jobId);
      } catch {
        // History is best effort.
      }
      // Like the other tools: results after delivery and History, so a failed delivery shows only the error.
      this.results = await jobResults(outputs, record).catch(() => []);
      this.savedTo = savedToLabel(!!handle, this.folder.ref?.name);
      this.progress = { percent: 100, status: finishedStems(outputs.length) };
      notifyFinished("Stems", outputs.length);
    } catch (error) {
      const err = error as Error & { details?: string };
      this.failure = { message: err.message, details: err.details ?? err.stack ?? "" };
      this.progress = null;
    } finally {
      this.running = false;
    }
  }

  /**
   * One long-lived worker, reused across jobs and never terminated: WebKit crashes the page
   * when a worker holding a WebGPU device is terminated. Cancel is cooperative (checked
   * between segments), so no hard stop is needed; only a worker that died is replaced.
   */
  private runWorker(request: ToolRequest): Promise<OutputRef[] | null> {
    this.worker ??= new Worker(new URL("../../../workers/job.worker.ts", import.meta.url), { type: "module", name: "job" });
    const worker = this.worker;
    worker.addEventListener("error", () => {
      if (this.worker === worker) this.worker = null;
    }, { once: true });
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
    if (this.progress) this.progress = { ...this.progress, status: STEM_PROGRESS.cancelling };
    this.worker?.postMessage({ type: "cancel" } satisfies ToolRequest);
  }

  /** Load Job (spec 07/15): stems, format, bitrate, export folder; the source is named. */
  loadFromHistory(record: Record<string, unknown>): void {
    if (this.running) return;
    this.restored = true;
    this.clear();
    if (Array.isArray(record.stems)) this.stems = orderStems(record.stems.filter((s): s is StemChoice => (STEM_CHOICES as readonly unknown[]).includes(s)));
    if ((STEM_FORMATS as readonly unknown[]).includes(record.format)) this.format = record.format as StemFormat;
    if ((MP3_BITRATES as readonly unknown[]).includes(record.bitrate)) this.bitrate = record.bitrate as Mp3Bitrate;
    if (isFolderRef(record.output)) void this.folder.set(record.output);
    this.pendingSource = ((record.source as { name?: unknown } | null)?.name as string | undefined) || null;
  }

  clear(): void {
    if (this.running) return;
    this.progress = null;
    this.warnings = [];
    this.results = [];
    this.failure = null;
    this.pendingSource = null;
    void this.setSource(null);
    this.stems = [...DEFAULT_STEMS];
    this.format = "wav";
    this.bitrate = "320k";
    void this.folder.set(app.settings["general/default_output"]);
  }
}

export const stemSplitter = new StemSplitterState();
