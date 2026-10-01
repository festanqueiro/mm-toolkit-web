/** Semantic-version helpers — port of `mm_toolkit/versioning.py`. */

const SEMANTIC_VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

export type VersionTuple = [major: number, minor: number, patch: number];

/** Comparable semantic version, accepting an optional `v` tag prefix; null if not semver. */
export function versionTuple(value: string): VersionTuple | null {
  const match = SEMANTIC_VERSION.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Whether `candidate` is a valid semantic version newer than `current`. */
export function isNewerVersion(current: string, candidate: string): boolean {
  const a = versionTuple(current);
  const b = versionTuple(candidate);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (b[i]! !== a[i]!) return b[i]! > a[i]!;
  }
  return false;
}
