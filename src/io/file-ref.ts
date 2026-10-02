/**
 * FileRef: the web stand-in for the desktop's absolute path strings (spec 11).
 * Handles (Chromium File System Access) are persisted in IndexedDB so a file or
 * folder can be re-opened later after the user re-grants permission.
 */
import { dbDelete, dbGet, dbSet } from "../storage/db";

export type FileRef = {
  id: string;
  name: string;
  kind: "file" | "directory";
  size?: number;
  lastModified?: number;
  /** True when a FileSystemHandle was persisted (Chromium only). */
  hasHandle: boolean;
};

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** A ref for an in-session File (from <input> or drag & drop). Not re-openable after reload. */
export function fileRefFromFile(file: File): FileRef {
  return { id: newId(), name: file.name, kind: "file", size: file.size, lastModified: file.lastModified, hasHandle: false };
}

/** A ref backed by a persisted FileSystemHandle. */
export async function fileRefFromHandle(handle: FileSystemHandle): Promise<FileRef> {
  const ref: FileRef = { id: newId(), name: handle.name, kind: handle.kind, hasHandle: true };
  if (handle.kind === "file") {
    const file = await (handle as FileSystemFileHandle).getFile();
    ref.size = file.size;
    ref.lastModified = file.lastModified;
  }
  await dbSet("handles", ref.id, handle);
  return ref;
}

export async function handleFor<T extends FileSystemHandle = FileSystemHandle>(ref: FileRef | null | undefined): Promise<T | null> {
  if (!ref?.hasHandle) return null;
  return ((await dbGet<FileSystemHandle>("handles", ref.id)) as T | undefined) ?? null;
}

export async function forgetRef(ref: FileRef | null | undefined): Promise<void> {
  if (ref?.hasHandle) await dbDelete("handles", ref.id);
}

type PermissionHandle = FileSystemHandle & {
  queryPermission?: (d: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
};

/** Current permission without prompting. Browsers without the API grant implicitly. */
export async function queryPermission(handle: FileSystemHandle, mode: "read" | "readwrite"): Promise<PermissionState> {
  const h = handle as PermissionHandle;
  return h.queryPermission ? h.queryPermission({ mode }) : "granted";
}

/** Prompt for permission; must be called from a user gesture. */
export async function requestPermission(handle: FileSystemHandle, mode: "read" | "readwrite"): Promise<boolean> {
  const h = handle as PermissionHandle;
  if ((await queryPermission(handle, mode)) === "granted") return true;
  return h.requestPermission ? (await h.requestPermission({ mode })) === "granted" : false;
}

/** Identity used to match per-track settings to a re-selected file (desktop used the path). */
export const trackIdentity = (ref: Pick<FileRef, "name" | "size" | "lastModified">) =>
  `${ref.name}|${ref.size ?? "?"}|${ref.lastModified ?? "?"}`;
