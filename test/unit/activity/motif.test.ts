import { describe, it, expect } from '@jest/globals';
import { discoverMotif, stepLabel } from '../../../src/activity/motif.js';
import type { ActivityEvent } from '../../../src/activity/types.js';

function at(iso: string, operation: string, entity: string): ActivityEvent {
  return {
    at: iso, actor: 'a', family: 'SOAP', operation, entity, kind: 'read',
    eventType: 'ApiTotalUsage', raw: {},
  };
}

/** Three repeats of query A -> create B, then one departure. */
function stream(): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  let t = 0;
  const push = (op: string, ent: string): void => {
    out.push(at(new Date(Date.UTC(2026, 8, 14, 12, 0, t)).toISOString(), op, ent));
    t += 1;
  };
  for (let i = 0; i < 20; i += 1) {
    push('query', 'A');
    push('create', 'B');
  }
  push('delete', 'Z');
  return out;
}

describe('stepLabel', () => {
  it('labels an event by operation and entity', () => {
    expect(stepLabel(at('2026-09-14T12:00:00.000Z', 'query', 'Order'))).toBe('query:Order');
  });

  it('falls back to a dash when there is no entity', () => {
    const e = at('2026-09-14T12:00:00.000Z', 'POST', '');
    expect(stepLabel({ ...e, entity: undefined })).toBe('POST:-');
  });
});

describe('discoverMotif', () => {
  it('returns empty reports for fewer than two events', () => {
    const r = discoverMotif([at('2026-09-14T12:00:00.000Z', 'query', 'A')]);
    expect(r.transitions).toEqual([]);
    expect(r.dominant).toEqual([]);
    expect(r.offPattern).toEqual([]);
  });

  it('counts transitions and orders them most frequent first', () => {
    const r = discoverMotif(stream());
    expect(r.transitions[0].from).toBe('query:A');
    expect(r.transitions[0].to).toBe('create:B');
    expect(r.transitions[0].count).toBe(20);
  });

  it('reports each transition share as a fraction of all transitions', () => {
    const r = discoverMotif(stream());
    const total = r.transitions.reduce((a, t) => a + t.count, 0);
    expect(total).toBe(40);
    expect(r.transitions[0].share).toBeCloseTo(20 / 40, 6);
  });

  it('separates the dominant path from the off-pattern tail', () => {
    const r = discoverMotif(stream());
    const labels = r.dominant.map((t) => `${t.from}>${t.to}`);
    expect(labels).toContain('query:A>create:B');
    expect(r.offPattern.some((t) => t.to === 'delete:Z')).toBe(true);
  });

  it('honours an overridden dominant share', () => {
    const wide = discoverMotif(stream(), { dominantShare: 1 });
    expect(wide.offPattern).toEqual([]);
    expect(wide.dominant).toHaveLength(wide.transitions.length);
  });

  it('sorts defensively so an unsorted input does not invent transitions', () => {
    const a = at('2026-09-14T12:00:00.000Z', 'query', 'A');
    const b = at('2026-09-14T12:00:01.000Z', 'create', 'B');
    expect(discoverMotif([b, a]).transitions[0]).toEqual({
      from: 'query:A', to: 'create:B', count: 1, share: 1,
    });
  });

  it('orders tied transitions deterministically rather than by input order', () => {
    // Two equally-frequent next steps from the same origin: the case the previous comparator
    // could not order, where cmp(a,b) and cmp(b,a) both returned 1 and the result depended on
    // which way the input happened to be arranged.
    const build = (order: readonly string[]): string[] => {
      const evs: ActivityEvent[] = [];
      let s = 0;
      for (const to of order) {
        evs.push(at(new Date(Date.UTC(2026, 8, 14, 12, 0, s)).toISOString(), 'query', 'A'));
        s += 1;
        evs.push(at(new Date(Date.UTC(2026, 8, 14, 12, 0, s)).toISOString(), 'create', to));
        s += 1;
      }
      return discoverMotif(evs).transitions.map((t) => `${t.from}>${t.to}`);
    };
    const forwards = build(['B', 'C', 'B', 'C']);
    const backwards = build(['C', 'B', 'C', 'B']);
    expect(forwards.filter((l) => l.startsWith('query:A>'))).toEqual(backwards.filter((l) => l.startsWith('query:A>')));
  });
});
