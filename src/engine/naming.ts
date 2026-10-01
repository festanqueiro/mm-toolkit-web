/** Output naming — port of `core.safe_filename` / `core.resolve_output`. */

export type ConflictPolicy = "rename" | "overwrite" | "skip";

// eslint-disable-next-line no-control-regex
const UNSAFE = /[<>:"/\\|?*\x00-\x1f]/g;

/** Replace characters that are invalid in file names, then trim spaces/dots. */
export function safeFilename(value: string): string {
  const cleaned = value.replace(UNSAFE, "-").replace(/^[ .]+|[ .]+$/g, "");
  return cleaned || "Untitled";
}

function splitName(name: string): [stem: string, ext: string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/**
 * Apply the conflict policy to a requested file name. `exists` reports whether a
 * name is already taken in the destination. Returns null when the file should be skipped.
 */
export async function resolveOutput(
  name: string,
  policy: ConflictPolicy,
  exists: (candidate: string) => boolean | Promise<boolean>,
): Promise<string | null> {
  if (!["rename", "overwrite", "skip"].includes(policy)) throw new Error(`Unknown conflict policy: ${policy}`);
  if (policy === "overwrite" || !(await exists(name))) return name;
  if (policy === "skip") return null;
  const [stem, ext] = splitName(name);
  for (let counter = 2; ; counter++) {
    const candidate = `${stem} (${counter})${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
}
