import { describe, it, expect } from '@jest/globals';
import { segmentCycles } from '../../../src/activity/cycles.js';
import type { ActivityEvent } from '../../../src/activity/types.js';

function at(iso: string, operation: string, entity: string): ActivityEvent {
  return {
    at: iso, actor: 'a', family: 'SOAP', operation, entity,
    kind: operation === 'query' ? 'read' : 'write',
    eventType: 'ApiTotalUsage', raw: {},
  };
}

const isUpdateOrder = (e: ActivityEvent): boolean => e.operation === 'update' && e.entity === 'Order';

describe('segmentCycles', () => {
  it('returns no cycles for no events', () => {
    expect(segmentCycles([], isUpdateOrder)).toEqual([]);
  });

  it('closes a cycle at the delimiter and marks it complete', () => {
    const cycles = segmentCycles([
      at('2026-09-14T12:00:00.000Z', 'query', 'Transaction__c'),
      at('2026-09-14T12:00:01.000Z', 'create', 'Stock__c'),
      at('2026-09-14T12:00:02.000Z', 'update', 'Order'),
    ], isUpdateOrder);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].complete).toBe(true);
    expect(cycles[0].count).toBe(3);
    expect(cycles[0].durationMs).toBe(2000);
  });

  it('splits into one cycle per delimiter', () => {
    const cycles = segmentCycles([
      at('2026-09-14T12:00:00.000Z', 'query', 'Order'),
      at('2026-09-14T12:00:01.000Z', 'update', 'Order'),
      at('2026-09-14T12:00:02.000Z', 'query', 'Order'),
      at('2026-09-14T12:00:03.000Z', 'update', 'Order'),
    ], isUpdateOrder);
    expect(cycles).toHaveLength(2);
  });

  it('returns a trailing group with no delimiter and marks it incomplete', () => {
    const cycles = segmentCycles([
      at('2026-09-14T12:00:00.000Z', 'query', 'Order'),
      at('2026-09-14T12:00:01.000Z', 'update', 'Order'),
      at('2026-09-14T12:00:02.000Z', 'query', 'Order'),
    ], isUpdateOrder);
    expect(cycles).toHaveLength(2);
    expect(cycles[1].complete).toBe(false);
  });

  it('defaults units to one, which makes msPerUnit equal durationMs', () => {
    const [c] = segmentCycles([
      at('2026-09-14T12:00:00.000Z', 'query', 'Order'),
      at('2026-09-14T12:00:02.000Z', 'update', 'Order'),
    ], isUpdateOrder);
    expect(c.units).toBe(1);
    expect(c.msPerUnit).toBe(2000);
  });

  it('normalises by a caller-supplied unit count', () => {
    const countLines = (c: ActivityEvent[]): number =>
      c.filter((e) => e.operation === 'create' && e.entity === 'Stock__c').length;
    const [c] = segmentCycles([
      at('2026-09-14T12:00:00.000Z', 'create', 'Stock__c'),
      at('2026-09-14T12:00:01.000Z', 'create', 'Stock__c'),
      at('2026-09-14T12:00:04.000Z', 'update', 'Order'),
    ], isUpdateOrder, countLines);
    expect(c.units).toBe(2);
    expect(c.msPerUnit).toBe(2000);
  });

  it('never lets units fall below one, so msPerUnit cannot divide by zero', () => {
    const [c] = segmentCycles([
      at('2026-09-14T12:00:00.000Z', 'query', 'Order'),
      at('2026-09-14T12:00:02.000Z', 'update', 'Order'),
    ], isUpdateOrder, () => 0);
    expect(c.units).toBe(1);
    expect(c.msPerUnit).toBe(2000);
  });

  it('keeps the steps, so a caller can show where inside a cycle the time went', () => {
    const [c] = segmentCycles([
      at('2026-09-14T12:00:00.000Z', 'query', 'Transaction__c'),
      at('2026-09-14T12:03:00.000Z', 'update', 'Order'),
    ], isUpdateOrder);
    expect(c.steps).toHaveLength(2);
    expect(Date.parse(c.steps[1].at) - Date.parse(c.steps[0].at)).toBe(180_000);
  });

  it('throws rather than let an unparseable timestamp reach msPerUnit', () => {
    const events = [at('1999-bad-date', 'query', 'Order'), at('2026-01-05T12:00:05.000Z', 'update', 'Order')];
    expect(() => segmentCycles(events, isUpdateOrder)).toThrow(/Unparseable/);
  });
});
