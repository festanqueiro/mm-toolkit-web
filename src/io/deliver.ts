/**
 * Hand staged outputs to the user (main thread only): one download per file, or a single
 * streamed ZIP for batches when "Batch download as ZIP" is on (spec 10, Tier 2 browsers).
 */
import { makeZip } from "client-zip";
import { resolveOutput } from "../engine/naming";
import { stagedFile, type OutputRef } from "./sink";

/** Names unique within one ZIP, using the desktop's "rename" policy: `name (2).ext`. */
export async function uniqueZipNames(names: string[]): Promise<string[]> {
  const taken = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const unique = (await resolveOutput(name, "rename", (n) => taken.has(n)))!;
    taken.add(unique);
    result.push(unique);
  }
  return result;
}

/** `{tool} export YYYY-MM-DD HH-MM.zip` in local time. */
export function zipName(tool: string, date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
  return `${tool} export ${stamp}.zip`;
}

/** A ZIP stream of the given files, with in-ZIP name conflicts renamed. */
export async function zipStream(files: File[]): Promise<ReadableStream<Uint8Array>> {
  const names = await uniqueZipNames(files.map((f) => f.name));
  return makeZip(files.map((file, i) => ({ input: file, name: names[i]!, lastModified: new Date(file.lastModified) })));
}

function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser time to start reading the blob before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function deliverStaged(outputs: OutputRef[], options: { zip: boolean; tool: string }): Promise<void> {
  const files = await Promise.all(outputs.map((ref) => stagedFile(ref)));
  if (options.zip && files.length > 1) {
    const blob = await new Response(await zipStream(files)).blob();
    triggerDownload(blob, zipName(options.tool));
    return;
  }
  for (const file of files) triggerDownload(file, file.name);
}
