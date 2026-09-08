import { describe, it, expect } from '@jest/globals';
import { validateGraph } from '../../../src/graph/validate.js';
import { GRAPH_RULES } from '../../../src/graph/rules.js';
import { SUPPORTED_GRAPH_SCHEMA_VERSION } from '../../../src/graph/types.js';

const doc = (over: Record<string, unknown> = {}) => ({
  schemaVersion: SUPPORTED_GRAPH_SCHEMA_VERSION,
  capturedAt: '2026-01-01T00:00:00Z',
  orgId: '00Dxx0000000000EAA',
  nodes: [],
  edges: [],
  coverage: { notes: [], unavailable: [] },
  ...over,
});

describe('schema 1.2.0 coverage', () => {
  it('supports 1.2.0', () => {
    expect(SUPPORTED_GRAPH_SCHEMA_VERSION).toBe('1.2.0');
  });

  it('accepts a document carrying coverage', () => {
    expect(validateGraph(doc())).toEqual([]);
  });

  it('accepts a recorded absence', () => {
    expect(
      validateGraph(
        doc({
          coverage: {
            notes: ['connected apps not readable'],
            unavailable: [{ scope: 'landscape.connectedApps', reason: 'failed', detail: 'INSUFFICIENT_ACCESS' }],
          },
        }),
      ),
    ).toEqual([]);
  });

  it('rejects a document with no coverage at all', () => {
    const without = doc();
    delete (without as Record<string, unknown>).coverage;
    expect(validateGraph(without).map((f) => f.code)).toContain(GRAPH_RULES.SCHEMA_SHAPE);
  });

  it('rejects a 1.0.0 document loudly rather than loading it partially', () => {
    expect(validateGraph(doc({ schemaVersion: '1.0.0' })).map((f) => f.code)).toContain(
      GRAPH_RULES.SCHEMA_VERSION_UNSUPPORTED,
    );
  });
});
