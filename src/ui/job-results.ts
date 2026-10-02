/**
 * A finished job's outputs as results the rail can play and download (spec: tool layout
 * redesign, "Results data flow"). In-memory outputs (no OPFS) carry their File; everything
 * else resolves like History does: the export folder's handle, or the kept OPFS copy.
 */
import { resolveOutputs, type AvailableOutput } from "../io/history-outputs";
import type { OutputRef } from "../io/sink";

export async function jobResults(outputs: OutputRef[], record: Record<string, unknown>, root?: FileSystemDirectoryHandle): Promise<AvailableOutput[]> {
  if (!outputs.length) return [];
  if (outputs.every((o) => o.file)) return outputs.map((o) => ({ name: o.name, open: async () => o.file!, staged: false }));
  return (await resolveOutputs(record, root)).files;
}

export const savedToLabel = (directory: boolean, folderName: string | undefined) =>
  directory ? `Saved to ${folderName || "your export folder"}` : "Downloaded";
