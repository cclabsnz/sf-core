import { describe, it, expect } from '@jest/globals';
import {
  parseCsv, normalise, sessionise, segmentCycles, flagOutliers, discoverMotif,
  decomposeComposite, isSupportedEventType,
} from '../../../src/index.js';
import type { ActivityEvent } from '../../../src/index.js';

/** The 0-based index, within `corpus()`'s 12 cycles, that the generator stalls. */
const STALLED_CYCLE_INDEX = 10;

/**
 * Build the corpus in code rather than checking in a large CSV: the shape is what matters, and
 * generating it keeps the invariants (cycle count, stall position) visible and adjustable.
 *
 * Spans three days with one empty middle day, and carries two CONNECTED_APP_NAME values, so the
 * gate covers all four fixture properties spec §7 names: a motif, a stall, a multi-day gap and a
 * shared identity. The two additions are placed so neither disturbs the calibrated cycle content:
 * the second app's traffic lands after the last cycle delimiter fires (day 1, within the idle-gap
 * window), and day 3's traffic uses that same second app, so filtering on `app` alone recovers the
 * original twelve-cycle sequence unchanged for the segmentCycles/flagOutliers assertions below.
 */
function corpus(): string {
  const header = [
    'TIMESTAMP_DERIVED', 'USER_NAME', 'CONNECTED_APP_NAME', 'API_FAMILY',
    'HTTP_METHOD', 'API_RESOURCE', 'ENTITY_NAME', 'REQUEST_ID', 'CLIENT_IP', 'STATUS_CODE',
  ];
  const rows: string[][] = [];
  let t = Date.UTC(2026, 0, 5, 12, 0, 0);
  let req = 0;

  const row = (op: string, entity: string, stepMs: number, app = 'Example Integration'): void => {
    t += stepMs;
    req += 1;
    rows.push([
      new Date(t).toISOString(), 'svc@example.test', app, 'SOAP',
      '', op, entity, `REQ${req}`, '192.0.2.10', '200',
    ]);
  };

  // Day 1 (2026-01-05): the calibrated twelve-cycle sequence, unchanged.
  for (let cycle = 0; cycle < 12; cycle += 1) {
    // Cycle 0 is a bigger order — six line items instead of one or two — so its raw
    // duration is an outlier even though its per-line rate is unremarkable. That is what
    // makes the naive (raw-duration) measure flag more than the normalised one below: a
    // bigger order and a hung one look alike until you divide by units of work.
    const lines = cycle === 0 ? 6 : (cycle % 3) + 1;
    // The eleventh cycle (index STALLED_CYCLE_INDEX) stalls between its first and second step.
    const stall = cycle === STALLED_CYCLE_INDEX ? 180_000 : 100;
    row('query', 'Ledger__c', 100);
    for (let l = 0; l < lines; l += 1) {
      row('query', 'OrderLine', l === 0 ? stall : 100);
      row('query', 'Item', 50);
      row('create', 'Movement__c', 50);
      row('create', 'Ledger__c', 50);
    }
    row('query', 'Order', 50);
    row('update', 'Order', 50);
    t += 2000; // gap between cycles, well inside the run threshold
  }

  // Still day 1, moments later: a second connected app's traffic, close enough behind the
  // cycle sequence to land in the same idle-gap window. This is the run that must carry both
  // apps — the "shared identity" property spec §7 names.
  row('query', 'Heartbeat__c', 5_000, 'Example Batch');
  row('query', 'Heartbeat__c', 5_000, 'Example Batch');

  // Day 2 (2026-01-06): nothing. The zero-call day the investigation's motivating finding was
  // about, and the property no earlier version of this gate covered.

  // Day 3 (2026-01-07): activity resumes after the gap.
  t = Date.UTC(2026, 0, 7, 9, 0, 0);
  row('query', 'Heartbeat__c', 0, 'Example Batch');
  row('query', 'Heartbeat__c', 5_000, 'Example Batch');
  row('update', 'Heartbeat__c', 5_000, 'Example Batch');

  const quote = (v: string): string => `"${v.replace(/"/g, '""')}"`;
  return [header, ...rows].map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n';
}

const events = normalise(parseCsv(corpus()), 'ApiTotalUsage');
// The calibrated day-1 sequence only: segmentCycles and flagOutliers below are calibrated
// against exactly these twelve cycles, and must not see the day-3/second-app additions above.
const cycleEvents = events.filter((e) => e.app === 'Example Integration');
const isUpdateOrder = (e: ActivityEvent): boolean => e.operation === 'update' && e.entity === 'Order';
const countLines = (c: ActivityEvent[]): number =>
  c.filter((e) => e.operation === 'create' && e.entity === 'Movement__c').length;

describe('activity engine, end to end', () => {
  it('parses and classifies every row', () => {
    expect(events.length).toBeGreaterThan(100);
    expect(events.every((e) => e.kind === 'read' || e.kind === 'write')).toBe(true);
  });

  it('splits into separate runs across the multi-day gap', () => {
    const runs = sessionise(events, 5 * 60 * 1000);
    expect(runs).toHaveLength(2);
    // Day 2 is a zero-call day: the gap between day 1's run and day 3's run spans it, far
    // wider than any idle threshold worth tuning — the multi-day gap made visible as two runs.
    const gapMs = new Date(runs[1].from).getTime() - new Date(runs[0].to).getTime();
    expect(gapMs).toBeGreaterThan(24 * 60 * 60 * 1000);
  });

  it('carries both apps on the run they share, rather than averaging the identity away', () => {
    const [firstRun] = sessionise(events, 5 * 60 * 1000);
    expect(firstRun.apps).toHaveLength(2);
  });

  it('recovers the motif: the per-line loop is the dominant path', () => {
    const m = discoverMotif(events);
    const labels = m.dominant.map((tr) => `${tr.from}>${tr.to}`);
    expect(labels).toContain('query:OrderLine>query:Item');
    expect(labels).toContain('query:Item>create:Movement__c');
    expect(labels).toContain('create:Movement__c>create:Ledger__c');
  });

  it('segments exactly twelve complete cycles', () => {
    const cycles = segmentCycles(cycleEvents, isUpdateOrder, countLines);
    expect(cycles).toHaveLength(12);
    expect(cycles.every((c) => c.complete)).toBe(true);
  });

  it('flags exactly one cycle once normalised per line item, and it is the stalled one', () => {
    const cycles = segmentCycles(cycleEvents, isUpdateOrder, countLines);
    const r = flagOutliers(cycles, (c) => c.msPerUnit);
    const flagged = r.flags.filter((f) => f.severity !== null);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe('hung');
    // Not just that one cycle was flagged, but that it is the one the generator actually
    // stalled — an off-by-one in the delimiter loop could shift the effect onto a neighbour
    // and still produce "exactly one hung cycle", passing a gate that had stopped proving
    // what it claims.
    expect(flagged[0].item).toBe(cycles[STALLED_CYCLE_INDEX]);
    expect(r.underpowered).toBe(false);
  });

  it('flags strictly more when measuring raw duration than when measuring per line item, which is why the normaliser exists', () => {
    const cycles = segmentCycles(cycleEvents, isUpdateOrder, countLines);
    const naive = flagOutliers(cycles, (c) => c.durationMs).flags.filter((f) => f.severity !== null);
    const normalised = flagOutliers(cycles, (c) => c.msPerUnit).flags.filter((f) => f.severity !== null);
    expect(naive.length).toBeGreaterThan(normalised.length);
  });
});

/**
 * A second, deliberately separate corpus for the composite join.
 *
 * Kept apart from `corpus()` above so the calibrated cycle/anomaly numbers there are never
 * disturbed by an unrelated change. This corpus is small on purpose: it only needs to exercise
 * decomposeComposite and isSupportedEventType, which the main corpus never reaches because it
 * is 100% SOAP through the ApiTotalUsage adapter.
 */
function compositeCorpus(): { parents: string; children: string } {
  const parentHeader = [
    'TIMESTAMP_DERIVED', 'USER_NAME', 'CONNECTED_APP_NAME', 'API_FAMILY',
    'HTTP_METHOD', 'API_RESOURCE', 'ENTITY_NAME', 'REQUEST_ID', 'CLIENT_IP', 'STATUS_CODE',
  ];
  const childHeader = [
    'TIMESTAMP_DERIVED', 'USER_ID', 'METHOD', 'URI', 'REQUEST_ID', 'CLIENT_IP', 'STATUS_CODE',
  ];
  const quote = (v: string): string => `"${v.replace(/"/g, '""')}"`;
  const toCsv = (header: string[], rows: string[][]): string =>
    [header, ...rows].map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n';

  const t0 = Date.UTC(2026, 0, 5, 13, 0, 0);
  const at = (offsetMs: number): string => new Date(t0 + offsetMs).toISOString();

  // One composite parent call, whose actual work happens in its two subrequests.
  const parentRows: string[][] = [
    [at(0), 'svc@example.test', 'Example Integration', 'REST', 'POST', '/v61.0/composite', '', 'COMPREQ1', '192.0.2.30', '200'],
  ];
  // Subrequests never carry actor or app of their own — that is why the join exists.
  const childRows: string[][] = [
    [at(10), '', 'GET', '/services/data/v61.0/sobjects/Ledger__c/aBc000000000001', 'COMPREQ1', '192.0.2.30', '200'],
    [at(20), '', 'POST', '/services/data/v61.0/sobjects/Movement__c', 'COMPREQ1', '192.0.2.30', '201'],
  ];

  return { parents: toCsv(parentHeader, parentRows), children: toCsv(childHeader, childRows) };
}

describe('activity engine, composite join', () => {
  const { parents: parentCsv, children: childCsv } = compositeCorpus();
  const parents = normalise(parseCsv(parentCsv), 'ApiTotalUsage');
  const subrequests = normalise(parseCsv(childCsv), 'CompositeApiSubrequest');

  it('recognises both event types the join needs', () => {
    expect(isSupportedEventType('ApiTotalUsage')).toBe(true);
    expect(isSupportedEventType('CompositeApiSubrequest')).toBe(true);
  });

  it('resolves the parent and attaches its children', () => {
    const result = decomposeComposite(parents, subrequests);
    expect(result.resolved).toBe(1);
    expect(result.unresolved).toBe(0);
    expect(result.orphans).toBe(0);
    expect(result.duplicates).toBe(0);
    // Parent plus its two subrequests.
    expect(result.events).toHaveLength(3);
  });

  it('has the children inherit the parent actor and app, since subrequests carry neither', () => {
    const result = decomposeComposite(parents, subrequests);
    const children = result.events.filter((e) => e.requestId === 'COMPREQ1' && e.eventType === 'CompositeApiSubrequest');
    expect(children).toHaveLength(2);
    for (const child of children) {
      expect(child.actor).toBe('svc@example.test');
      expect(child.app).toBe('Example Integration');
    }
  });

  it('classifies the resolved children instead of leaving them unknown', () => {
    const result = decomposeComposite(parents, subrequests);
    const children = result.events.filter((e) => e.requestId === 'COMPREQ1' && e.eventType === 'CompositeApiSubrequest');
    const kinds = children.map((c) => c.kind).sort();
    // GET -> read, POST -> write. Neither is 'unknown': the composite container itself is
    // unknown (it names no operation of its own), but its decomposed children are not.
    expect(kinds).toEqual(['read', 'write']);
  });
});
