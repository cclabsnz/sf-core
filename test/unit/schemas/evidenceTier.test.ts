import { describe, it, expect } from '@jest/globals';
import Ajv from 'ajv';
import { loadSchema } from '../../../src/schemas/index.js';

/**
 * The evidence tier grades what an org can actually evidence. `intel map` previously stamped
 * 'C' whenever no probe had run, asserting a measurement that never happened — the one thing
 * an evidence tool must never do. The contract therefore has to be able to say "not measured".
 *
 * Expressed as null rather than an omitted field: a reader that forgets to handle null gets a
 * loud undefined, whereas a missing key silently reads as "no tier information", which is the
 * same ambiguity in a different costume.
 */
const ajv = new Ajv({ strict: false, allErrors: true });
const validate = ajv.compile(loadSchema('coupling-graph') as object);

const graph = (evidenceTier: unknown) => ({
  version: 1,
  provenance: {
    tool: 'orgintel',
    toolVersion: '0.1.1',
    generatedAt: '2026-07-30T00:00:00.000Z',
    orgId: '00Dxx0000000000EAA',
    evidenceTier,
  },
  nodes: [{ object: 'Case', custom: false, automationCounts: { flows: 1, triggers: 0, approvals: 0 }, recordCount90d: 5 }],
  edges: [],
});

describe('coupling-graph evidenceTier', () => {
  it('accepts null — the honest representation of "not measured"', () => {
    expect(validate(graph(null))).toBe(true);
  });

  it.each(['A', 'B', 'C', 'D'])('still accepts a measured tier %s', (tier) => {
    expect(validate(graph(tier))).toBe(true);
  });

  it('still rejects a tier outside the scale', () => {
    expect(validate(graph('Z'))).toBe(false);
    expect(validate(graph(3))).toBe(false);
  });

  it('still requires the field to be present', () => {
    const g = graph(null) as { provenance: Record<string, unknown> };
    delete g.provenance.evidenceTier;
    expect(validate(g)).toBe(false);
  });
});
