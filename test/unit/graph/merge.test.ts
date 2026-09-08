// test/unit/graph/merge.test.ts
// One canonical graph assembled from fragments written by different tools, neither of which has
// to have run first. See sf-orgviz/docs/CONVERGENCE_SPEC.md section 3.
import { describe, it, expect } from '@jest/globals';
import { mergeGraphs } from '../../../src/graph/merge.js';
import type { CanonicalGraph } from '../../../src/graph/types.js';
import { validateGraph } from '../../../src/graph/validate.js';
import { RULES } from '../../../src/graph/rules.js';

function fragment(over: Partial<CanonicalGraph>): CanonicalGraph {
  return {
    schemaVersion: '1.2.0',
    capturedAt: '2026-01-02T00:00:00Z',
    orgId: 'org1',
    nodes: [],
    edges: [],
    coverage: { notes: [], unavailable: [] },
    ...over,
  };
}

const account = {
  id: 'obj.Account', kind: 'sobject', layer: 'data' as const, level: 2 as const,
  parent: null, label: 'Account', attrs: {},
  provenance: { source: 'metadata' as const, capturedAt: '2026-01-02T00:00:00Z' },
};

const orderRouter = {
  id: 'flow.Order_Router', kind: 'flow', layer: 'process' as const, level: 2 as const,
  parent: null, label: 'Order_Router', attrs: {},
  provenance: { source: 'metadata' as const, capturedAt: '2026-01-01T00:00:00Z' },
};

describe('mergeGraphs', () => {
  it('unions the nodes and edges of every fragment', () => {
    const result = mergeGraphs([
      fragment({ producer: 'orgviz', nodes: [account] }),
      fragment({
        producer: 'orgintel',
        capturedAt: '2026-01-01T00:00:00Z',
        nodes: [orderRouter],
        edges: [{
          from: 'flow.Order_Router', to: 'obj.Account', kind: 'writes', attrs: {},
          provenance: { source: 'metadata', capturedAt: '2026-01-01T00:00:00Z' },
        }],
      }),
    ]);
    expect(result.findings).toEqual([]);
    expect(result.graph!.nodes.map((n) => n.id).sort()).toEqual(['flow.Order_Router', 'obj.Account']);
    expect(result.graph!.edges).toHaveLength(1);
  });

  it('takes the oldest capturedAt, because a picture is as fresh as its stalest part', () => {
    // The newest would let a fresh map run make a month-old extraction look current.
    const result = mergeGraphs([
      fragment({ producer: 'orgviz', capturedAt: '2026-01-02T00:00:00Z' }),
      fragment({ producer: 'orgintel', capturedAt: '2026-01-01T00:00:00Z' }),
    ]);
    expect(result.graph!.capturedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('keeps every fragment own capture time in the report', () => {
    const result = mergeGraphs([
      fragment({ producer: 'orgviz', capturedAt: '2026-01-02T00:00:00Z' }),
      fragment({ producer: 'orgintel', capturedAt: '2026-01-01T00:00:00Z' }),
    ]);
    expect(result.report.fragments).toEqual([
      { producer: 'orgviz', capturedAt: '2026-01-02T00:00:00Z' },
      { producer: 'orgintel', capturedAt: '2026-01-01T00:00:00Z' },
    ]);
  });

  it('unions coverage, so a fact nobody could read stays unread', () => {
    const result = mergeGraphs([
      fragment({
        producer: 'orgviz',
        coverage: { notes: ['a'], unavailable: [{ scope: 'landscape.sites', reason: 'deferred', detail: 'not extracted' }] },
      }),
      fragment({
        producer: 'orgintel',
        coverage: { notes: ['b'], unavailable: [{ scope: 'process.apex', reason: 'failed', detail: 'no SymbolTable' }] },
      }),
    ]);
    expect(result.graph!.coverage.notes).toEqual(['a', 'b']);
    expect(result.graph!.coverage.unavailable.map((u) => u.scope)).toEqual([
      'landscape.sites', 'process.apex',
    ]);
  });

  it('leaves the merged graph with no producer of its own', () => {
    const result = mergeGraphs([fragment({ producer: 'orgviz' }), fragment({ producer: 'orgintel' })]);
    expect(result.graph!.producer).toBeUndefined();
  });

  it('resolves an edge whose endpoints came from different fragments', () => {
    // The normal case, not an exception: a couples edge from sf-orgintel joins two obj.* nodes
    // from sf-orgviz. The merged graph must validate clean, which is what proves the merge
    // produced one graph rather than two stapled together.
    const result = mergeGraphs([
      fragment({ producer: 'orgviz', nodes: [account] }),
      fragment({
        producer: 'orgintel',
        nodes: [orderRouter],
        edges: [{
          from: 'flow.Order_Router', to: 'obj.Account', kind: 'writes', attrs: {},
          provenance: { source: 'metadata', capturedAt: '2026-01-01T00:00:00Z' },
        }],
      }),
    ]);
    expect(validateGraph(result.graph)).toEqual([]);
  });

  it('reports an endpoint that no fragment resolved, rather than thinning the graph', () => {
    // A missing fragment must produce a named finding. Silently dropping the edge would leave a
    // graph that looks complete and is not.
    const result = mergeGraphs([
      fragment({
        producer: 'orgintel',
        nodes: [orderRouter],
        edges: [{
          from: 'flow.Order_Router', to: 'obj.Account', kind: 'writes', attrs: {},
          provenance: { source: 'metadata', capturedAt: '2026-01-01T00:00:00Z' },
        }],
      }),
    ]);
    // The merge itself succeeds -- an unresolved endpoint is the validator's finding to make.
    expect(result.graph).not.toBeNull();
    const findings = validateGraph(result.graph);
    expect(findings.map((f) => f.code)).toContain(RULES.EDGE_ENDPOINT_UNRESOLVED);
  });
});
