import { describe, it, expect } from '@jest/globals';
import { validateGraph } from '../../../src/graph/validate.js';
import { RULES } from '../../../src/graph/rules.js';
import { SUPPORTED_SCHEMA_VERSION } from '../../../src/graph/types.js';

const minimal = {
  schemaVersion: SUPPORTED_SCHEMA_VERSION,
  capturedAt: '2026-09-07T00:00:00Z',
  orgId: '00Dxx0000000000',
  nodes: [
    {
      id: 'org.root',
      kind: 'org',
      layer: 'landscape',
      level: 0,
      parent: null,
      label: 'Acme',
      attrs: {},
      provenance: { source: 'metadata', capturedAt: '2026-09-07T00:00:00Z' },
    },
  ],
  edges: [],
  coverage: { notes: [], unavailable: [] },
};

describe('validateGraph — structural', () => {
  it('accepts a minimal valid document', () => {
    expect(validateGraph(minimal)).toEqual([]);
  });

  it('rejects an unsupported schemaVersion loudly, not partially', () => {
    const findings = validateGraph({ ...minimal, schemaVersion: '2.0.0' });
    expect(findings.map((f) => f.code)).toContain(RULES.SCHEMA_VERSION_UNSUPPORTED);
    expect(findings[0].fix).toBeTruthy();
  });

  it('names the offending edge when provenance is missing', () => {
    const findings = validateGraph({
      ...minimal,
      edges: [{ from: 'org.root', to: 'org.root', kind: 'contains', attrs: {} }],
    });
    const finding = findings.find((f) => f.code === RULES.EDGE_MISSING_PROVENANCE);
    expect(finding).toBeDefined();
    expect(finding!.id).toBe('org.root->org.root');
  });

  it('returns findings rather than throwing on a document that is not an object', () => {
    expect(() => validateGraph(null)).not.toThrow();
    expect(validateGraph(null).length).toBeGreaterThan(0);
  });
});
