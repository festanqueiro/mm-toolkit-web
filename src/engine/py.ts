/** Helpers that reproduce Python semantics the desktop engine relies on. */

/** Python's built-in `round(x)`: round half to even (banker's rounding). */
export function pyRound(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}
