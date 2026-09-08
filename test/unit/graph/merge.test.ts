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

  it('compares capturedAt chronologically, not lexically', () => {
    // '...+05:00' at 23:00 is 18:00 UTC -- chronologically OLDER than '...Z' at 20:00 UTC, but
    // lexical `<` sorts the offset string after the Z string. A merge that compares strings
    // would pick the wrong one here.
    const result = mergeGraphs([
      fragment({ producer: 'orgviz', capturedAt: '2026-01-02T23:00:00+05:00' }),
      fragment({ producer: 'orgintel', capturedAt: '2026-01-02T20:00:00Z' }),
    ]);
    expect(result.graph!.capturedAt).toBe('2026-01-02T23:00:00+05:00');
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

  it('reports zero fragments as a finding instead of throwing', () => {
    // Array.reduce with no initial value throws on an empty array. A CLI calls this with
    // whatever graph files an operator passed, so an empty list is user input, not a
    // programming error, and mergeGraphs must stay total: every failure mode is a Finding.
    const result = mergeGraphs([]);
    expect(result.graph).toBeNull();
    expect(result.findings.map((f) => f.code)).toEqual([RULES.MERGE_NO_FRAGMENTS]);
    expect(result.report).toEqual({ fragments: [], contributionsApplied: 0 });
  });
});

describe('mergeGraphs rejections', () => {
  it('refuses fragments from different orgs', () => {
    // Merging two orgs produces a picture of neither.
    const result = mergeGraphs([
      fragment({ producer: 'orgviz', orgId: 'org1' }),
      fragment({ producer: 'orgintel', orgId: 'org2' }),
    ]);
    expect(result.graph).toBeNull();
    expect(result.findings.map((f) => f.code)).toContain(RULES.MERGE_ORG_MISMATCH);
    expect(result.findings.every((f) => f.fix.length > 0)).toBe(true);
  });

  it('refuses fragments at different schema versions', () => {
    const result = mergeGraphs([
      fragment({ producer: 'orgviz' }),
      fragment({ producer: 'orgintel', schemaVersion: '1.1.0' }),
    ]);
    expect(result.graph).toBeNull();
    expect(result.findings.map((f) => f.code)).toContain(RULES.MERGE_SCHEMA_VERSION_MISMATCH);
  });

  it('refuses a node id claimed by two fragments, naming the id', () => {
    const result = mergeGraphs([
      fragment({ producer: 'orgviz', nodes: [account] }),
      fragment({ producer: 'orgintel', nodes: [{ ...account }] }),
    ]);
    expect(result.graph).toBeNull();
    const collision = result.findings.find((f) => f.code === RULES.MERGE_ID_COLLISION);
    expect(collision!.id).toBe('obj.Account');
  });

  it('refuses a producer emitting a kind it does not own', () => {
    // The split is enforced, not documented: sf-orgviz emitting a flow node means its
    // extraction started reading Flow XML, which is a design change, not a merge input.
    const result = mergeGraphs([fragment({ producer: 'orgviz', nodes: [orderRouter] })]);
    expect(result.graph).toBeNull();
    const finding = result.findings.find((f) => f.code === RULES.MERGE_KIND_NOT_OWNED);
    expect(finding!.id).toBe('flow.Order_Router');
    expect(finding!.message).toContain('orgintel');
  });

  it('says nothing about ownership when a fragment does not name its producer', () => {
    // An unnamed producer cannot violate an ownership rule. It is a fragment written by hand or
    // by an older build, and the id-collision rule still covers the harm ownership prevents.
    const result = mergeGraphs([fragment({ nodes: [orderRouter] })]);
    expect(result.findings.map((f) => f.code)).not.toContain(RULES.MERGE_KIND_NOT_OWNED);
  });
});

describe('attribute contributions', () => {
  it('applies a contribution under the contributing producer namespace', () => {
    // Namespaced because an unnamespaced patch makes "who asserted this" unanswerable, and two
    // producers writing one key becomes a silent last-writer-wins.
    const result = mergeGraphs([
      fragment({ producer: 'orgviz', nodes: [account] }),
      fragment({
        producer: 'orgintel',
        contributions: [{ nodeId: 'obj.Account', attrs: { recordCount90d: 4210 } }],
      }),
    ]);
    expect(result.findings).toEqual([]);
    const merged = result.graph!.nodes.find((n) => n.id === 'obj.Account')!;
    expect(merged.attrs).toEqual({ orgintel: { recordCount90d: 4210 } });
    expect(result.report.contributionsApplied).toBe(1);
  });

  it('leaves the owner own attributes untouched', () => {
    const result = mergeGraphs([
      fragment({ producer: 'orgviz', nodes: [{ ...account, attrs: { custom: false } }] }),
      fragment({
        producer: 'orgintel',
        contributions: [{ nodeId: 'obj.Account', attrs: { recordCount90d: 4210 } }],
      }),
    ]);
    const merged = result.graph!.nodes.find((n) => n.id === 'obj.Account')!;
    expect(merged.attrs.custom).toBe(false);
    expect(merged.attrs.orgintel).toEqual({ recordCount90d: 4210 });
  });

  it('reports a contribution naming a node no fragment provides', () => {
    // Reported, not dropped: a measurement about a node nobody extracted is a missing fragment,
    // which the reader needs told rather than silently discarded.
    const result = mergeGraphs([
      fragment({ producer: 'orgviz', nodes: [account] }),
      fragment({
        producer: 'orgintel',
        contributions: [{ nodeId: 'obj.Missing', attrs: { recordCount90d: 1 } }],
      }),
    ]);
    const finding = result.findings.find((f) => f.code === RULES.MERGE_CONTRIBUTION_UNRESOLVED);
    expect(finding!.id).toBe('obj.Missing');
  });

  it('does not mutate the fragment it was given', () => {
    // mergeGraphs is called on documents a caller may still be holding.
    const owner = fragment({ producer: 'orgviz', nodes: [account] });
    mergeGraphs([
      owner,
      fragment({ producer: 'orgintel', contributions: [{ nodeId: 'obj.Account', attrs: { x: 1 } }] }),
    ]);
    expect(owner.nodes[0].attrs).toEqual({});
  });
});
