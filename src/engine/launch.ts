/** File Handling (spec 09): where "Open with MM Toolkit" sends the launched files. */
import { mediaKind } from "./media-kind";

export type LaunchTarget = { route: "cutter" | "converter"; files: number[] } | null;

/**
 * One usable audio/video file → Media Cutter; several → Media Converter (which explains a
 * mixed batch itself). Unsupported files are dropped; none left → nothing to do.
 */
export function launchTarget(names: string[]): LaunchTarget {
  const usable = names.map((name, i) => (mediaKind(name) ? i : -1)).filter((i) => i >= 0);
  if (!usable.length) return null;
  return { route: usable.length === 1 ? "cutter" : "converter", files: usable };
}
