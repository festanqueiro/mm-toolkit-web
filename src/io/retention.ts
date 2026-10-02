/**
 * Staged-output retention (spec 07). Off: staged copies only live until the next job or app
 * load (a download reads them lazily, so they can't be deleted right away). On ("Keep copies
 * of outputs for History"): they stay for History, oldest jobs evicted beyond the cap.
 */
import { evictOldest, KEEP_COPIES_CAP } from "../engine/history";
import { clearAllStaging, removeStagedJobs, stagingUsage } from "./sink";

export async function prepareStaging(keepCopies: boolean, keep: string[] = [], cap = KEEP_COPIES_CAP, root?: FileSystemDirectoryHandle): Promise<void> {
  if (!keepCopies) return clearAllStaging(keep, root);
  await removeStagedJobs(evictOldest(await stagingUsage(root), cap, keep), root);
}

export async function keptBytes(root?: FileSystemDirectoryHandle): Promise<number> {
  return (await stagingUsage(root)).reduce((sum, job) => sum + job.bytes, 0);
}
