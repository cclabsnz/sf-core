import { countKinds } from './sessionise.js';
import { byTime, eventMs } from './time.js';
import type { ActivityEvent, Cycle } from './types.js';

function toCycle(
  group: ActivityEvent[],
  complete: boolean,
  countUnits: (c: ActivityEvent[]) => number,
): Cycle {
  const from = group[0].at;
  const to = group[group.length - 1].at;
  const durationMs = eventMs(to) - eventMs(from);
  // Floor of one: a cycle with no countable unit still took the time it took, and dividing by
  // zero would produce Infinity and poison the outlier statistics downstream.
  const units = Math.max(1, Math.floor(countUnits(group)));
  return {
    from,
    to,
    count: group.length,
    kinds: countKinds(group),
    durationMs,
    units,
    msPerUnit: durationMs / units,
    complete,
    steps: group,
  };
}

/**
 * Split events into cycles, each ending at the first event satisfying isDelimiter.
 *
 * The delimiter is supplied by the caller because the unit of work is org-specific — for one
 * stock integration it is `update` on `Order`.
 *
 * countUnits supplies the normaliser the anomaly pass divides by. It defaults to one, which
 * reproduces the naive raw-duration measure on purpose so the difference is visible in tests:
 * flagging raw duration on real data flagged 78 of 161 cycles and was useless, while flagging
 * duration per unit of work flagged 2 and found the incident.
 */
export function segmentCycles(
  events: readonly ActivityEvent[],
  isDelimiter: (e: ActivityEvent) => boolean,
  countUnits: (cycle: ActivityEvent[]) => number = () => 1,
): Cycle[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort(byTime);

  const cycles: Cycle[] = [];
  let group: ActivityEvent[] = [];

  for (const e of sorted) {
    group.push(e);
    if (isDelimiter(e)) {
      cycles.push(toCycle(group, true, countUnits));
      group = [];
    }
  }
  if (group.length > 0) cycles.push(toCycle(group, false, countUnits));
  return cycles;
}
