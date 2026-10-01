/** Timestamp parsing/formatting — port of `core.parse_timestamp` / `core.format_timestamp`. */

import { pyRound } from "./py";

const NUMBER_PART = /^\d+(?:\.\d+)?$/;

/** Parse seconds, MM:SS, or HH:MM:SS into seconds. Throws with the desktop's exact messages. */
export function parseTimestamp(value: string): number {
  const text = value.trim();
  if (!text) throw new Error("Timestamp cannot be empty.");
  const parts = text.split(":");
  if (parts.length > 3 || parts.some((part) => !NUMBER_PART.test(part.trim()))) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  const numbers = parts.map((part) => Number.parseFloat(part));
  const [hours, minutes, seconds] =
    numbers.length === 3 ? numbers : numbers.length === 2 ? [0, ...numbers] : [0, 0, ...numbers];
  if (minutes! >= 60 || (seconds! >= 60 && numbers.length > 1)) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return hours! * 3600 + minutes! * 60 + seconds!;
}

/** Format seconds as HH:MM:SS, rounding to whole seconds the way Python's `round` does. */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, pyRound(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
}
