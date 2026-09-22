import { describe, it, expect } from '@jest/globals';
import { flagOutliers, median } from '../../../src/activity/anomaly.js';

describe('median', () => {
  it('takes the middle value of an odd-length set', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it('averages the middle pair of an even-length set', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('returns zero for an empty set', () => {
    expect(median([])).toBe(0);
  });
});

describe('flagOutliers', () => {
  const id = (n: number): number => n;

  it('reports no flags for a uniform set', () => {
    const r = flagOutliers([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2], id);
    expect(r.flags.filter((f) => f.severity !== null)).toEqual([]);
    expect(r.median).toBe(2);
  });

  it('flags a value beyond three MAD as slow', () => {
    // median 11, MAD 1, so slow above 14 and hung above 31. 20 is slow, nothing else moves.
    const items = [10, 11, 12, 10, 11, 12, 10, 11, 12, 10, 11, 20];
    const r = flagOutliers(items, id);
    expect(r.median).toBe(11);
    expect(r.mad).toBe(1);
    const flagged = r.flags.filter((f) => f.severity !== null);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].item).toBe(20);
    expect(flagged[0].severity).toBe('slow');
  });

  it('escalates a value beyond twenty MAD to hung', () => {
    const items = [10, 11, 12, 10, 11, 12, 10, 11, 12, 10, 11, 200];
    const flagged = flagOutliers(items, id).flags.filter((f) => f.severity !== null);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe('hung');
  });

  it('treats any value above the median as hung when the set has no spread', () => {
    // MAD of a uniform set is 0, so there is no scale to multiply. Documented, not accidental:
    // with no spread there is no basis for a middle "slow" band.
    const r = flagOutliers([5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 9], id);
    expect(r.mad).toBe(0);
    const flagged = r.flags.filter((f) => f.severity !== null);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe('hung');
  });

  it('is not dragged around by its own outlier, unlike mean and standard deviation', () => {
    // One extreme value inflates a standard deviation enough to hide itself. MAD does not move.
    const items = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 100_000];
    const r = flagOutliers(items, id);
    expect(r.median).toBe(10);
    expect(r.mad).toBe(0);
    expect(r.flags.filter((f) => f.severity !== null)).toHaveLength(1);
  });

  it('marks a small sample underpowered', () => {
    expect(flagOutliers([1, 2, 3], id).underpowered).toBe(true);
    expect(flagOutliers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], id).underpowered).toBe(false);
  });

  it('returns median and mad so a caller can state the threshold it applied', () => {
    const r = flagOutliers([1, 2, 3, 4, 5], id);
    expect(r.median).toBe(3);
    expect(r.mad).toBe(1);
  });

  it('returns an empty report for no items', () => {
    const r = flagOutliers([], id);
    expect(r.flags).toEqual([]);
    expect(r.median).toBe(0);
    expect(r.underpowered).toBe(true);
  });

  it('applies the measure callback rather than assuming the item is a number', () => {
    const cycles = Array.from({ length: 12 }, (_, i) => ({ msPerUnit: i === 11 ? 900 : 10 }));
    const flagged = flagOutliers(cycles, (c) => c.msPerUnit).flags.filter((f) => f.severity !== null);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].value).toBe(900);
  });

  it('honours overridden multiples', () => {
    // median 11, MAD 1. At madMultiple 100 the slow threshold is 111, so 20 is not flagged.
    const items = [10, 11, 12, 10, 11, 12, 10, 11, 12, 10, 11, 20];
    expect(flagOutliers(items, id, { madMultiple: 100 }).flags.filter((f) => f.severity !== null)).toEqual([]);
  });

  it('throws rather than silently exempt an item whose measure is not finite', () => {
    const items = [10, 11, 12, 10, 11, 12, 10, 11, 12, 10, 11, NaN];
    expect(() => flagOutliers(items, id)).toThrow(/non-finite/);
  });

  it('throws rather than let a non-finite measure disable detection for the whole batch', () => {
    // Without the guard this returned median=NaN and flagged nothing at all — including the
    // genuine 900 outlier sitting in the same batch.
    const items = [NaN, NaN, NaN, NaN, NaN, NaN, 10, 11, 12, 13, 14, 900];
    expect(() => flagOutliers(items, id)).toThrow(/non-finite/);
  });
});
