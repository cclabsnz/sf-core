import { describe, it, expect } from '@jest/globals';
import Ajv from 'ajv';
import { loadSchema } from '../../../src/schemas/index.js';

/**
 * A record-triggered flow or an Apex trigger knows something a plain coupling does not: when a
 * Case changes, a WorkOrder is created. That is process order — the difference between "these
 * objects are coupled" and "this happens, then that happens".
 *
 * Expressed as evidence about the canonical from/to pair rather than by reordering it, so a
 * consumer that only cares about coupling is unaffected. Absent means no directional evidence,
 * which is not the same as "undirected" — the contract must not force a guess.
 */
const ajv = new Ajv({ strict: false, allErrors: true });
const validate = ajv.compile(loadSchema('coupling-graph') as object);

const edge = (extra: Record<string, unknown> = {}) => ({
  from: 'Case',
  to: 'WorkOrder',
  weight: 3,
  operations: ['create'],
  components: [{ type: 'Flow', name: 'Case_Router', confidence: 'high' }],
  ...extra,
});

const graph = (e: unknown) => ({
  version: 1,
  provenance: {
    tool: 'orgintel', toolVersion: '0.1.3', generatedAt: '2026-07-31T00:00:00.000Z',
    orgId: '00Dxx0000000000EAA', evidenceTier: 'B',
  },
  nodes: [{ object: 'Case', custom: false, automationCounts: { flows: 1, triggers: 0, approvals: 0 }, recordCount90d: 5, layer: 'business' }],
  edges: [e],
});

describe('coupling-graph edge direction', () => {
  it.each(['from-to', 'to-from', 'both'])('accepts direction %s', (direction) => {
    expect(validate(graph(edge({ direction })))).toBe(true);
  });

  it('accepts an edge with no directional evidence', () => {
    expect(validate(graph(edge()))).toBe(true);
  });

  it('rejects a direction outside the defined set', () => {
    expect(validate(graph(edge({ direction: 'sideways' })))).toBe(false);
    expect(validate(graph(edge({ direction: true })))).toBe(false);
  });

  it('still rejects an unknown property on an edge', () => {
    expect(validate(graph(edge({ directoin: 'from-to' })))).toBe(false);
  });
});
