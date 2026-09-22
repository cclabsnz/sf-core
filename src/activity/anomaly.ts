import type { OutlierFlag, OutlierReport } from './types.js';

/** Below this many items, MAD is a prompt to look rather than evidence. */
const UNDERPOWERED_BELOW = 12;

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Flag outliers using median and median absolute deviation.
 *
 * Mean and standard deviation are deliberately not used: a single extreme value inflates a
 * standard deviation enough to hide itself, which is exactly the case this exists to catch.
 *
 * The measure callback is the whole design. On real data, measuring raw cycle duration flagged
 * 78 of 161 cycles because the unit of work varied; measuring duration per unit of work flagged
 * 2, and those 2 were the incident. The engine cannot choose the normaliser, so it does not try.
 */
export function flagOutliers<T>(
  items: readonly T[],
  measure: (t: T) => number,
  opts?: { madMultiple?: number; severeMultiple?: number },
): OutlierReport<T> {
  const madMultiple = opts?.madMultiple ?? 3;
  const severeMultiple = opts?.severeMultiple ?? 20;

  if (items.length === 0) {
    return { flags: [], median: 0, mad: 0, underpowered: true };
  }

  const values = items.map((item, i) => {
    const v = measure(item);
    if (!Number.isFinite(v)) {
      // Guard here, not only in callers. A non-finite measure does not throw and does not
      // flag: NaN > threshold is always false, so one bad value silently exempts itself, and
      // a NaN landing at the median index poisons median and mad and silently disables
      // detection for the whole batch. sessionise.ts and cycles.ts throw upstream for this
      // reason; this is the function their comments name as the thing being protected.
      throw new Error(`measure() returned a non-finite value (${String(v)}) for item at index ${i}`);
    }
    return v;
  });
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));

  // With zero spread any value above the median is an outlier; there is no scale to compare
  // against, so fall back to a bare inequality rather than multiplying zero.
  const slowAt = mad === 0 ? med : med + madMultiple * mad;
  const hungAt = mad === 0 ? med : med + severeMultiple * mad;

  const flags: Array<OutlierFlag<T>> = items.map((item, i) => {
    const value = values[i];
    let severity: 'slow' | 'hung' | null = null;
    if (value > hungAt) severity = 'hung';
    else if (value > slowAt) severity = 'slow';
    return { item, value, severity };
  });

  return { flags, median: med, mad, underpowered: items.length < UNDERPOWERED_BELOW };
}
