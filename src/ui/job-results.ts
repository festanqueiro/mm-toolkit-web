/**
 * A finished job's outputs as results the rail can play and download (spec: tool layout
 * redesign, "Results data flow"). In-memory outputs (no OPFS) carry their File; everything
 * else resolves like History does: the export folder's handle, or the kept OPFS copy. An
 * output that can't be found is still listed, with an `open` that rejects.
 */
import { resolveOutputs, type AvailableOutput } from "../io/history-outputs";
import type { OutputRef } from "../io/sink";

export async function jobResults(outputs: OutputRef[], record: Record<string, unknown>, root?: FileSystemDirectoryHandle): Promise<AvailableOutput[]> {
  if (!outputs.length) return [];
  if (outputs.every((o) => o.file)) return outputs.map((o) => ({ name: o.name, open: async () => o.file!, staged: false }));
  const found = await resolveOutputs(record, root).then(
    (lookup) => lookup.files,
    () => [] as AvailableOutput[],
  );
  // Every output stays listed, in job order; one that can't be found here won't open (the rail says so).
  return outputs.map((o) => found.find((f) => f.name === o.name) ?? { name: o.name, open: () => Promise.reject(new Error(UNAVAILABLE)), staged: false });
}

export const UNAVAILABLE = "Can't be opened here. See History.";

export const savedToLabel = (directory: boolean, folderName: string | undefined) =>
  directory ? `Saved to ${folderName || "your export folder"}` : "Downloaded";
