/**
 * A tool's export folder (spec 10, Tier 1): a persisted directory handle plus its current
 * write permission. Tier 2 browsers never pick one and export through Downloads instead.
 */
import { fileRefFromHandle, forgetRef, handleFor, queryPermission, requestPermission, type FileRef } from "../io/file-ref";
import { app } from "./state.svelte";

export class OutputFolder {
  ref = $state<FileRef | null>(null);
  permission = $state<PermissionState | "none">("none");
  /** The live handle (persisted copies are only needed after a reload). */
  private handle: FileSystemDirectoryHandle | null = null;

  /** `id` lets the browser remember a separate start folder per tool. */
  constructor(private readonly pickerId: string) {}

  /** Tier 2 always exports (Downloads); Tier 1 needs a folder with write permission. */
  get ok(): boolean {
    return !app.capabilities?.directoryPicker || (this.ref !== null && this.permission === "granted");
  }

  /** Switch to a saved ref (restore, Clear) and re-check its permission. */
  async set(ref: FileRef | null): Promise<void> {
    this.ref = ref;
    this.handle = null;
    await this.refresh();
  }

  async choose(): Promise<void> {
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await showDirectoryPicker({ id: this.pickerId, mode: "readwrite" });
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return;
      throw error;
    }
    const previous = this.ref;
    this.handle = handle;
    this.ref = await fileRefFromHandle(handle);
    this.permission = await queryPermission(handle, "readwrite");
    // Forget the old handle unless a saved setting still points at it.
    const saved = [app.settings["general/default_output"]?.id, app.settings.output?.id, app.settings["clips/output"]?.id];
    if (previous && !saved.includes(previous.id)) await forgetRef(previous);
  }

  async current(): Promise<FileSystemDirectoryHandle | null> {
    if (this.handle && this.ref) return this.handle;
    this.handle = await handleFor<FileSystemDirectoryHandle>(this.ref);
    return this.handle;
  }

  async reallow(): Promise<void> {
    const handle = await this.current();
    if (handle && (await requestPermission(handle, "readwrite"))) this.permission = "granted";
  }

  async refresh(): Promise<void> {
    this.handle = null;
    const handle = await this.current();
    this.permission = handle ? await queryPermission(handle, "readwrite") : "none";
  }
}
