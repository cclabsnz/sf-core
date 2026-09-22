import { byTime, eventMs } from './time.js';
import type { ActivityEvent, KindCounts, Run } from './types.js';

export function countKinds(events: readonly ActivityEvent[]): KindCounts {
  const k: KindCounts = { read: 0, write: 0, destructive: 0, control: 0, unknown: 0 };
  for (const e of events) k[e.kind] += 1;
  return k;
}

function toRun(group: ActivityEvent[]): Run {
  const from = group[0].at;
  const to = group[group.length - 1].at;
  const durationMs = eventMs(to) - eventMs(from);
  const seconds = durationMs / 1000;
  const apps = [...new Set(group.map((e) => e.app).filter((a): a is string => a !== undefined))];
  return {
    from,
    to,
    count: group.length,
    kinds: countKinds(group),
    durationMs,
    // A zero-duration run has no elapsed time to divide by, so its rate is just its count:
    // finite and comparable rather than Infinity. Runs with real elapsed time use it, because
    // flooring a 196ms burst of 50 calls to "50/s" hides a 255/s burst from the outlier pass.
    ratePerSec: durationMs === 0 ? group.length : group.length / (durationMs / 1000),
    apps,
  };
}

/**
 * Group events into runs, splitting wherever the idle gap is exceeded.
 *
 * A gap exactly equal to idleGapMs stays in the same run: the threshold is the longest silence
 * still considered continuous.
 */
export function sessionise(events: readonly ActivityEvent[], idleGapMs: number): Run[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort(byTime);

  const runs: Run[] = [];
  let group: ActivityEvent[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const gap = eventMs(sorted[i].at) - eventMs(sorted[i - 1].at);
    if (gap > idleGapMs) {
      runs.push(toRun(group));
      group = [sorted[i]];
    } else {
      group.push(sorted[i]);
    }
  }
  runs.push(toRun(group));
  return runs;
}
