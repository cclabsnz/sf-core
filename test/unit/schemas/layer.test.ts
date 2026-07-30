import { describe, it, expect } from '@jest/globals';
import Ajv from 'ajv';
import { loadSchema } from '../../../src/schemas/index.js';

/**
 * Objects carry an architectural layer so a consumer does not have to reimplement the
 * classifier to tell a business object from a permission table.
 *
 * Additive rather than required: the contract is published, and documents emitted before this
 * field existed must keep validating. The emitter always sets it, which its own schema test
 * asserts — so "optional in the contract, guaranteed in practice" is checked, not hoped for.
 */
const ajv = new Ajv({ strict: false, allErrors: true });
const validate = ajv.compile(loadSchema('coupling-graph') as object);

const node = (extra: Record<string, unknown> = {}) => ({
  object: 'Case',
  custom: false,
  automationCounts: { flows: 1, triggers: 0, approvals: 0 },
  recordCount90d: 5,
  ...extra,
});

const graph = (n: unknown) => ({
  version: 1,
  provenance: {
    tool: 'orgintel', toolVersion: '0.1.2', generatedAt: '2026-07-30T00:00:00.000Z',
    orgId: '00Dxx0000000000EAA', evidenceTier: 'B',
  },
  nodes: [n],
  edges: [],
});

describe('coupling-graph node layer', () => {
  it.each(['integration', 'configuration', 'business', 'content', 'sharing', 'security', 'observability'])(
    'accepts the %s layer',
    (layer) => {
      expect(validate(graph(node({ layer })))).toBe(true);
    },
  );

  it('still accepts a node emitted before the field existed', () => {
    expect(validate(graph(node()))).toBe(true);
  });

  it('rejects a layer outside the defined set', () => {
    expect(validate(graph(node({ layer: 'nonsense' })))).toBe(false);
  });

  it('still rejects an unknown property, so typos are caught', () => {
    expect(validate(graph(node({ layerr: 'business' })))).toBe(false);
  });
});
