import { describe, it, expect } from '@jest/globals';
import { sessionise, countKinds } from '../../../src/activity/sessionise.js';
import type { ActivityEvent } from '../../../src/activity/types.js';

function at(iso: string, p: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    at: iso, actor: 'a', family: 'SOAP', operation: 'query', kind: 'read',
    eventType: 'ApiTotalUsage', raw: {}, ...p,
  };
}

describe('sessionise', () => {
  it('returns no runs for no events', () => {
    expect(sessionise([], 1000)).toEqual([]);
  });

  it('groups events closer together than the gap into one run', () => {
    const runs = sessionise([
      at('2026-09-14T12:00:00.000Z'),
      at('2026-09-14T12:00:01.000Z'),
      at('2026-09-14T12:00:02.000Z'),
    ], 5000);
    expect(runs).toHaveLength(1);
    expect(runs[0].count).toBe(3);
    expect(runs[0].durationMs).toBe(2000);
  });

  it('splits when the gap is exceeded', () => {
    const runs = sessionise([
      at('2026-09-14T12:00:00.000Z'),
      at('2026-09-14T12:00:10.000Z'),
    ], 5000);
    expect(runs).toHaveLength(2);
  });

  it('keeps a gap exactly equal to the threshold in the same run', () => {
    const runs = sessionise([
      at('2026-09-14T12:00:00.000Z'),
      at('2026-09-14T12:00:05.000Z'),
    ], 5000);
    expect(runs).toHaveLength(1);
  });

  it('splits one millisecond past the threshold', () => {
    const runs = sessionise([
      at('2026-09-14T12:00:00.000Z'),
      at('2026-09-14T12:00:05.001Z'),
    ], 5000);
    expect(runs).toHaveLength(2);
  });

  it('sorts defensively, so an unsorted input does not fabricate runs', () => {
    const runs = sessionise([
      at('2026-09-14T12:00:02.000Z'),
      at('2026-09-14T12:00:00.000Z'),
      at('2026-09-14T12:00:01.000Z'),
    ], 5000);
    expect(runs).toHaveLength(1);
    expect(runs[0].from).toBe('2026-09-14T12:00:00.000Z');
    expect(runs[0].to).toBe('2026-09-14T12:00:02.000Z');
  });

  it('gives a single-event run zero duration and a rate of one', () => {
    const [r] = sessionise([at('2026-09-14T12:00:00.000Z')], 5000);
    expect(r.durationMs).toBe(0);
    expect(r.ratePerSec).toBe(1);
  });

  it('tallies kinds per run', () => {
    const [r] = sessionise([
      at('2026-09-14T12:00:00.000Z', { kind: 'read' }),
      at('2026-09-14T12:00:01.000Z', { kind: 'write' }),
      at('2026-09-14T12:00:02.000Z', { kind: 'unknown' }),
    ], 5000);
    expect(r.kinds).toEqual({ read: 1, write: 1, destructive: 0, control: 0, unknown: 1 });
  });

  it('lists the distinct apps in a run, so a shared identity stays visible', () => {
    const [r] = sessionise([
      at('2026-09-14T12:00:00.000Z', { app: 'Example Integration' }),
      at('2026-09-14T12:00:01.000Z', { app: 'Example Notifier' }),
      at('2026-09-14T12:00:02.000Z', { app: 'Example Integration' }),
    ], 5000);
    expect(r.apps).toEqual(['Example Integration', 'Example Notifier']);
  });

  it('throws rather than let an unparseable timestamp merge activity across a gap', () => {
    const events = [at('2026-09-14T12:00:00.000Z'), at('not-a-date'), at('2026-09-14T13:00:00.000Z')];
    expect(() => sessionise(events, 5000)).toThrow(/Unparseable/);
  });

  it('reports the true rate for a sub-second burst rather than flooring it', () => {
    const events = [];
    for (let i = 0; i < 50; i += 1) {
      events.push(at(new Date(Date.UTC(2026, 8, 14, 12, 0, 0, i * 4)).toISOString()));
    }
    const [r] = sessionise(events, 5000);
    expect(r.durationMs).toBe(196);
    expect(r.ratePerSec).toBeCloseTo(50 / 0.196, 1);
  });

  it('gives a multi-event run sharing one timestamp its count as a rate, not Infinity', () => {
    const iso = '2026-09-14T12:00:00.000Z';
    const [r] = sessionise([at(iso), at(iso), at(iso)], 5000);
    expect(r.durationMs).toBe(0);
    expect(r.ratePerSec).toBe(3);
  });

  it('sorts by parsed time, so a non-Z offset cannot invert a run', () => {
    const events = [
      { at: '2026-09-14T23:00:00+12:00', actor: 'a', family: 'SOAP', operation: 'query',
        kind: 'read' as const, eventType: 'ApiTotalUsage', raw: {} },
      { at: '2026-09-14T12:00:00.000Z', actor: 'a', family: 'SOAP', operation: 'query',
        kind: 'read' as const, eventType: 'ApiTotalUsage', raw: {} },
    ];
    const [run] = sessionise(events, 60_000);
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(run.from)).toBeLessThanOrEqual(Date.parse(run.to));
  });
});

describe('countKinds', () => {
  it('returns all zeros for no events', () => {
    expect(countKinds([])).toEqual({ read: 0, write: 0, destructive: 0, control: 0, unknown: 0 });
  });
});
