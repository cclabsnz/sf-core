import { byTime } from './time.js';
import type { ActivityEvent, MotifReport, Transition } from './types.js';

/** The label a transition is counted against. */
export function stepLabel(e: ActivityEvent): string {
  return `${e.operation}:${e.entity ?? '-'}`;
}

/**
 * Recover the repeating sequence from observed transitions.
 *
 * Bigram counts over operation:entity. On one real integration, 8 transitions covered 99% of
 * 1,782 and recovered the job's cycle exactly, which made the remaining tail — the departures
 * from its own pattern — the interesting part.
 */
export function discoverMotif(
  events: readonly ActivityEvent[],
  opts?: { dominantShare?: number },
): MotifReport {
  const dominantShare = opts?.dominantShare ?? 0.95;
  if (events.length < 2) return { transitions: [], dominant: [], offPattern: [] };

  const sorted = [...events].sort(byTime);
  const counts = new Map<string, { from: string; to: string; count: number }>();

  for (let i = 1; i < sorted.length; i += 1) {
    const from = stepLabel(sorted[i - 1]);
    const to = stepLabel(sorted[i]);
    const key = `${from}|${to}`;
    const cur = counts.get(key);
    if (cur === undefined) counts.set(key, { from, to, count: 1 });
    else cur.count += 1;
  }

  const total = [...counts.values()].reduce((a, t) => a + t.count, 0);
  const transitions: Transition[] = [...counts.values()]
    .map((t) => ({ ...t, share: t.count / total }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0),
    );

  // Walk most-frequent-first until the cumulative share reaches the threshold. Everything
  // after that point is the tail.
  const dominant: Transition[] = [];
  let cumulative = 0;
  for (const t of transitions) {
    if (cumulative >= dominantShare) break;
    dominant.push(t);
    cumulative += t.share;
  }
  const offPattern = transitions.slice(dominant.length);
  return { transitions, dominant, offPattern };
}
