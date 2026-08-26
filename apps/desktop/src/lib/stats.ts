import type { SelectionStats } from "./types";

/** Numeric-aware statistics over a list of cell display values. */
export function computeStats(values: string[]): SelectionStats {
  let numericCount = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (const raw of values) {
    const v = raw.trim();
    if (v === "") continue;
    count++;
    const n = parseFloat(v);
    if (!Number.isNaN(n)) {
      numericCount++;
      sum += n;
      if (n < min) min = n;
      if (n > max) max = n;
    }
  }
  return { count, numericCount, sum, min, max };
}
