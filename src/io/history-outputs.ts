/**
 * Which of a History job's outputs can still be opened (spec 07): files in the user's export
 * folder (Tier 1, when its permission is granted) and copies kept in OPFS. Never prompts.
 */
import { handleFor, queryPermission, type FileRef } from "./file-ref";
import { stagedFile, type OutputRef } from "./sink";

export type AvailableOutput = { name: string; open: () => Promise<File>; staged: boolean };
export type OutputLookup = { files: AvailableOutput[]; folder: { ref: FileRef; permission: PermissionState } | null };

/** A persisted export-folder ref (Tier 1), as History stores it. */
export const isFolderRef = (ref: unknown): ref is FileRef =>
  !!ref && typeof ref === "object" && (ref as FileRef).kind === "directory" && (ref as FileRef).hasHandle === true;

export async function resolveOutputs(record: Record<string, unknown>, root?: FileSystemDirectoryHandle): Promise<OutputLookup> {
  const outputs = (Array.isArray(record.outputs) ? record.outputs : []) as OutputRef[];
  const files: AvailableOutput[] = [];
  let folder: OutputLookup["folder"] = null;

  const inFolder = outputs.filter((o) => o.sink === "directory");
  if (inFolder.length && isFolderRef(record.output)) {
    const handle = await handleFor<FileSystemDirectoryHandle>(record.output).catch(() => null);
    if (handle) {
      const permission = await queryPermission(handle, "read").catch(() => "denied" as PermissionState);
      folder = { ref: record.output, permission };
      if (permission === "granted") {
        for (const output of inFolder) {
          try {
            const file = await handle.getFileHandle(output.name);
            files.push({ name: output.name, open: () => file.getFile(), staged: false });
          } catch {
            // Moved or deleted since.
          }
        }
      }
    }
  }

  for (const output of outputs.filter((o) => o.sink === "staged")) {
    try {
      const file = await stagedFile(output, root);
      files.push({ name: output.name, open: async () => file, staged: true });
    } catch {
      // Evicted, or cleared because copies aren't kept.
    }
  }
  return { files, folder };
}
