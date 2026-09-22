/** Milliseconds for an ActivityEvent.at. Throws rather than let NaN ride. */
export function eventMs(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    throw new Error(`Unparseable ActivityEvent.at: ${JSON.stringify(iso)}`);
  }
  return t;
}

/**
 * Chronological comparator.
 *
 * Compares parsed time, not string order. A lexicographic compare on `at` is only correct while
 * every producer emits Z-suffixed millisecond ISO; a non-Z offset sorts wrong and yields a `to`
 * earlier than its `from`, a negative durationMs and a negative rate, silently.
 */
export const byTime = (a: { at: string }, b: { at: string }): number => eventMs(a.at) - eventMs(b.at);
