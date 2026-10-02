/**
 * Output sinks (spec 10). Engine jobs write every output through an `OutputSink`, so the
 * same code serves a user-chosen folder (Chromium) and the private staging area used for
 * downloads/ZIPs (all browsers). Runs in Workers as well as on the main thread.
 */
import { resolveOutput, type ConflictPolicy } from "../engine/naming";

export type OutputRef = {
  name: string;
  /**
   * "directory": written into the user's folder; "staged": in OPFS, awaiting download;
   * "memory": held in memory (no OPFS, e.g. private browsing), carried in `file`.
   */
  sink: "directory" | "staged" | "memory";
  /** OPFS path segments for staged outputs. */
  opfsPath?: string[];
  /** In-memory outputs only. */
  file?: File;
  size?: number;
};

export interface OutputSink {
  readonly kind: OutputRef["sink"];
  exists(name: string): Promise<boolean>;
  /** Apply the conflict policy; null means "skip this output". */
  resolveName(requested: string, policy: ConflictPolicy): Promise<string | null>;
  create(name: string): Promise<WritableStream<Uint8Array>>;
  /** Delete a (partial) output after failure or cancel. Missing files are fine. */
  remove(name: string): Promise<void>;
  /** Mark an output as complete and return its reference. */
  complete(name: string): Promise<OutputRef>;
}

type SyncAccessHandle = {
  write(buffer: AllowSharedBufferSource, options?: { at?: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
};

/**
 * A writable stream for a file handle. Prefers `createWritable` (Chromium, Firefox, Safari 26+);
 * falls back to `createSyncAccessHandle`, which older Safari offers for OPFS inside Workers.
 */
export async function writableFor(handle: FileSystemFileHandle): Promise<WritableStream<Uint8Array>> {
  const h = handle as FileSystemFileHandle & {
    createWritable?: () => Promise<WritableStream<Uint8Array>>;
    createSyncAccessHandle?: () => Promise<SyncAccessHandle>;
  };
  if (typeof h.createWritable === "function") return h.createWritable();
  if (typeof h.createSyncAccessHandle !== "function") throw new Error("This browser cannot write files here.");
  const access = await h.createSyncAccessHandle();
  access.truncate(0);
  let offset = 0;
  return new WritableStream<Uint8Array>({
    write(chunk) {
      offset += access.write(chunk, { at: offset });
    },
    close() {
      access.flush();
      access.close();
    },
    abort() {
      access.close();
    },
  });
}

/** Writes into a directory handle: the user's chosen folder, or an OPFS staging folder. */
export class DirectorySink implements OutputSink {
  constructor(
    private readonly dir: FileSystemDirectoryHandle,
    readonly kind: OutputRef["sink"] = "directory",
    private readonly opfsPrefix: string[] = [],
  ) {}

  async exists(name: string): Promise<boolean> {
    try {
      await this.dir.getFileHandle(name);
      return true;
    } catch (error) {
      const name = (error as DOMException)?.name;
      if (name === "NotFoundError") return false;
      if (name === "TypeMismatchError") return true; // a folder already has this name
      throw error;
    }
  }

  resolveName(requested: string, policy: ConflictPolicy): Promise<string | null> {
    return resolveOutput(requested, policy, (candidate) => this.exists(candidate));
  }

  async create(name: string): Promise<WritableStream<Uint8Array>> {
    return writableFor(await this.dir.getFileHandle(name, { create: true }));
  }

  async remove(name: string): Promise<void> {
    try {
      await this.dir.removeEntry(name);
    } catch (error) {
      if ((error as DOMException)?.name !== "NotFoundError") throw error;
    }
  }

  async complete(name: string): Promise<OutputRef> {
    const file = await (await this.dir.getFileHandle(name)).getFile();
    return {
      name,
      sink: this.kind,
      size: file.size,
      ...(this.kind === "staged" ? { opfsPath: [...this.opfsPrefix, name] } : {}),
    };
  }
}

/**
 * Staging without OPFS (Safari private browsing, some test profiles): outputs are kept in
 * memory and handed to the page as `File`s for download. Fine for promo-sized outputs.
 */
export class MemorySink implements OutputSink {
  readonly kind = "memory" as const;
  private readonly files = new Map<string, File>();

  async exists(name: string): Promise<boolean> {
    return this.files.has(name);
  }

  resolveName(requested: string, policy: ConflictPolicy): Promise<string | null> {
    return resolveOutput(requested, policy, async (candidate) => this.files.has(candidate));
  }

  async create(name: string): Promise<WritableStream<Uint8Array>> {
    const chunks: Uint8Array[] = [];
    return new WritableStream<Uint8Array>({
      write: (chunk) => {
        chunks.push(chunk.slice());
      },
      close: () => {
        this.files.set(name, new File(chunks as BlobPart[], name, { type: name.endsWith(".mp4") ? "video/mp4" : "" }));
      },
    });
  }

  async remove(name: string): Promise<void> {
    this.files.delete(name);
  }

  async complete(name: string): Promise<OutputRef> {
    const file = this.files.get(name);
    if (!file) throw new Error(`${name} was not written.`);
    return { name, sink: "memory", file, size: file.size };
  }
}

const STAGING_ROOT = "exports";

/** A fresh OPFS folder for one job's outputs, delivered later as downloads or a ZIP. */
export async function createStagingSink(jobId: string, root?: FileSystemDirectoryHandle): Promise<DirectorySink> {
  const opfs = root ?? (await navigator.storage.getDirectory());
  const exports = await opfs.getDirectoryHandle(STAGING_ROOT, { create: true });
  const dir = await exports.getDirectoryHandle(jobId, { create: true });
  return new DirectorySink(dir, "staged", [STAGING_ROOT, jobId]);
}

/** Resolve a staged output back to its file. */
export async function stagedFile(ref: OutputRef, root?: FileSystemDirectoryHandle): Promise<File> {
  if (ref.file) return ref.file;
  if (!ref.opfsPath?.length) throw new Error(`${ref.name} is not a staged output.`);
  let dir = root ?? (await navigator.storage.getDirectory());
  for (const segment of ref.opfsPath.slice(0, -1)) dir = await dir.getDirectoryHandle(segment);
  return (await dir.getFileHandle(ref.opfsPath.at(-1)!)).getFile();
}

/**
 * Remove every staged job except `keep`. Never call this right after a download starts: the
 * download reads the OPFS file lazily, so deleting it cancels the download. Clean up when
 * the next job starts or the app loads instead.
 */
export async function clearAllStaging(keep: string[] = [], root?: FileSystemDirectoryHandle): Promise<void> {
  const opfs = root ?? (await navigator.storage.getDirectory());
  let exports: FileSystemDirectoryHandle;
  try {
    exports = await opfs.getDirectoryHandle(STAGING_ROOT);
  } catch {
    return;
  }
  const names: string[] = [];
  for await (const name of (exports as unknown as { keys: () => AsyncIterable<string> }).keys()) names.push(name);
  for (const name of names) if (!keep.includes(name)) await exports.removeEntry(name, { recursive: true }).catch(() => {});
}

/** Remove a job's staging folder (after delivery, unless outputs are kept for History). */
export async function clearStaging(jobId: string, root?: FileSystemDirectoryHandle): Promise<void> {
  const opfs = root ?? (await navigator.storage.getDirectory());
  try {
    await (await opfs.getDirectoryHandle(STAGING_ROOT)).removeEntry(jobId, { recursive: true });
  } catch (error) {
    if ((error as DOMException)?.name !== "NotFoundError") throw error;
  }
}
