/**
 * Media Cutter tab state (spec 05). Module-level so it survives switching tabs. Pure rules
 * live in `engine/clips.ts`; the player itself lives in the component (it needs the element).
 */
import { clipOutputFormat, clipRequests, CLIP_PROGRESS, emptyClipRow, finishedClips, rowsFromHistory, sourceReady, type ClipRow } from "../../../engine/clips";
import { isFolderRef } from "../../../io/history-outputs";
import type { MediaKind } from "../../../engine/media-kind";
import { formatTimestamp } from "../../../engine/time";
import type { FileRef } from "../../../io/file-ref";
import { deliverStaged } from "../../../io/deliver";
import { probeSource } from "../../../io/media-probe";
import { decodeAtNativeRate } from "../../../workers/media-client";
import { prepareStaging } from "../../../io/retention";
import type { OutputRef } from "../../../io/sink";
import { addHistory, historyId, localTimestamp } from "../../../storage/history";
import type { ToolRequest, Undecodable } from "../../../workers/render-protocol";
import { jobRecorded } from "../../history.svelte";
import type { AvailableOutput } from "../../../io/history-outputs";
import { historyOutputs, notifyFinished, runJob } from "../../job-runner";
import { jobResults, savedToLabel } from "../../job-results";
import { OutputFolder } from "../../output-folder.svelte";
import { app, resetSettings, updateSetting } from "../../state.svelte";

export type Source = { file: File; url: string; kind: MediaKind | null; ok: boolean; message: string; checking: boolean };

class CutterState {
  source = $state.raw<Source | null>(null);
  rows = $state<ClipRow[]>([emptyClipRow()]);
  /** The row Set Start / Set End write into (`null`: none, they fall back to row 0). */
  currentKey = $state<string | null>(null);
  readonly folder = new OutputFolder("mm-clips-export");

  running = $state(false);
  cancelling = $state(false);
  progress = $state<{ percent: number; status: string } | null>(null);
  /** The source named by Load Job that the user still has to pick (files aren't persisted). */
  pendingSource = $state<string | null>(null);
  /** The last finished job's History id (the progress label links to it). */
  lastJobId = $state<string | null>(null);
  /** The last job's files, playable in the rail (cleared by Clear and when a job starts). */
  results = $state.raw<AvailableOutput[]>([]);
  savedTo = $state("");
  warnings = $state<string[]>([]);
  failure = $state<{ message: string; details: string } | null>(null);

  private worker: Worker | null = null;
  private sourceToken = 0;
  private restored = false;

  get kind(): MediaKind | null {
    return this.source?.ok ? this.source.kind : null;
  }

  get currentIndex(): number {
    return this.rows.findIndex((row) => row.key === this.currentKey);
  }

  /** Choose (or clear) the source; later picks win over slower earlier probes. */
  async setSource(file: File | null): Promise<void> {
    const token = ++this.sourceToken;
    if (this.source) URL.revokeObjectURL(this.source.url);
    if (!file) {
      this.source = null;
      return;
    }
    this.pendingSource = null;
    this.source = { file, url: URL.createObjectURL(file), kind: null, ok: false, message: "", checking: true };
    const probe = await probeSource(file);
    if (token !== this.sourceToken || !this.source) return;
    this.source = probe.ok
      ? { ...this.source, kind: probe.kind, ok: true, message: sourceReady(probe.kind), checking: false }
      : { ...this.source, ok: false, message: probe.message, checking: false };
  }

  addRow(): void {
    const row = emptyClipRow();
    this.rows.push(row);
    this.currentKey = row.key;
  }

  /** Removing the last row adds a fresh empty one (desktop). */
  removeRow(key: string): void {
    this.rows = this.rows.filter((row) => row.key !== key);
    if (!this.rows.length) this.rows = [emptyClipRow()];
    if (this.currentKey === key) this.currentKey = null;
  }

  updateRow(key: string, patch: Partial<Omit<ClipRow, "key">>): void {
    const row = this.rows.find((r) => r.key === key);
    if (row) Object.assign(row, patch);
  }

  /** Set Start / Set End: the player position into the current row (row 0 when none is current). */
  setFromPlayer(field: "start" | "end", seconds: number): void {
    const row = this.rows.find((r) => r.key === this.currentKey) ?? this.rows[0];
    if (row) row[field] = formatTimestamp(seconds);
  }

  /** Restore the export folder once settings have loaded (`clips/output`, else the default). */
  restore(): void {
    if (this.restored || !app.settingsLoaded) return;
    this.restored = true;
    void this.folder.set(app.settings["clips/output"] ?? app.settings["general/default_output"]);
  }

  /** Create {Audio|Video} Clips: run the job in the cut Worker, deliver, record History. */
  async create(): Promise<void> {
    const source = this.source;
    if (this.running || !source?.ok) return;
    const { clips, error } = clipRequests($state.snapshot(this.rows));
    if (error || !clips.length) return;
    this.running = true;
    this.cancelling = false;
    this.failure = null;
    this.warnings = [];
    this.results = [];
    this.progress = { percent: 0, status: CLIP_PROGRESS.preparing };
    const s = app.settings;
    // Desktop saves these when the job starts. The source isn't re-openable yet (input persistence).
    if (this.folder.ref) void updateSetting("clips/output", $state.snapshot(this.folder.ref) as FileRef);

    const jobId = historyId();
    const tier1 = !!app.capabilities?.directoryPicker;
    await prepareStaging(s["web/keep_output_copies"]).catch(() => {});
    try {
      const handle = tier1 ? await this.folder.current() : null;
      if (tier1 && !handle) throw new Error("Choose a writable export folder.");
      const destination = handle ? ({ kind: "directory", handle } as const) : ({ kind: "staging", jobId } as const);
      const job = { source: source.file, clips, naming: s["general/clip_naming"], conflict: s["general/conflict_policy"] };
      let outputs: OutputRef[] | null;
      try {
        outputs = await this.runWorker({ type: "start", job: { tool: "clips", job }, destination });
      } catch (error) {
        // The Worker can't decode this audio here: decode it on the page and retry from PCM.
        const info = (error as { undecodable?: Undecodable }).undecodable;
        if (!info) throw error;
        const pcm = await decodeAtNativeRate(source.file, info.sampleRate, info.numberOfChannels).catch(() => {
          throw error;
        });
        outputs = this.cancelling ? null : await this.runWorker({ type: "start", job: { tool: "clips", job: { ...job, pcm } }, destination });
      }
      if (outputs === null) {
        this.progress = { percent: this.progress?.percent ?? 0, status: CLIP_PROGRESS.cancelled };
        return;
      }
      // Staged copies stay until the next job or app load: deleting them now would cancel the download.
      if (!handle && outputs.length) await deliverStaged(outputs, { zip: s["web/zip_batches"], tool: "Media Cutter" });
      const record = await this.record(jobId, source.file, clips, outputs, !!handle);
      this.results = await jobResults(outputs, record).catch(() => []);
      this.savedTo = savedToLabel(!!handle, this.folder.ref?.name);
      this.progress = { percent: 100, status: finishedClips(outputs.length) };
      notifyFinished("Clips", outputs.length);
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
    if (this.progress) this.progress = { ...this.progress, status: CLIP_PROGRESS.cancelling };
    this.worker?.postMessage({ type: "cancel" } satisfies ToolRequest);
  }

  private async record(id: string, source: File, clips: { title: string; start: number; duration: number }[], outputs: OutputRef[], directory: boolean): Promise<Record<string, unknown>> {
    const record = {
      id,
      tool: "clips" as const,
      created: localTimestamp(),
      source: { name: source.name, size: source.size, lastModified: source.lastModified },
      output: directory ? $state.snapshot(this.folder.ref) : { name: "Downloads" },
      clips,
      outputs: historyOutputs(outputs),
    };
    try {
      await addHistory(record);
      this.lastJobId = id;
      jobRecorded(id);
    } catch {
      // History is best effort (storage may be unavailable).
    }
    return record;
  }


  /** Load Job (spec 07): clip rows and export folder; the source is named for re-selection. */
  loadFromHistory(record: Record<string, unknown>): void {
    if (this.running) return;
    // The loaded job supersedes the one-time restore from Settings.
    this.restored = true;
    this.clear();
    const clips = (Array.isArray(record.clips) ? record.clips : []) as { title?: unknown; start?: unknown; duration?: unknown }[];
    const rows = rowsFromHistory(
      clips.map((c) => ({ title: typeof c.title === "string" ? c.title : "", start: Number(c.start) || 0, duration: Number(c.duration) || 60 })),
      formatTimestamp,
    );
    this.rows = rows.length ? rows : [emptyClipRow()];
    if (isFolderRef(record.output)) void this.folder.set(record.output);
    this.pendingSource = ((record.source as { name?: unknown } | null)?.name as string | undefined) || null;
  }

  /** Clear: source, one empty row, export folder back to the Settings default (desktop `clear`). */
  clear(): void {
    if (this.running) return;
    this.progress = null;
    this.warnings = [];
    this.results = [];
    void this.setSource(null);
    this.rows = [emptyClipRow()];
    this.currentKey = null;
    this.pendingSource = null;
    void this.folder.set(app.settings["general/default_output"]);
    void resetSettings(["clips/source", "clips/output"]);
  }

  /** `{Audio|Video} clips will be exported as {FORMAT} files.`, once a valid source is chosen. */
  get format() {
    return this.source?.ok ? clipOutputFormat(this.source.file.name) : null;
  }
}

export const cutter = new CutterState();
