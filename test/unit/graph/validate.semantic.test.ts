import { describe, it, expect } from '@jest/globals';
import { validateGraph } from '../../../src/graph/validate.js';
import { GRAPH_RULES } from '../../../src/graph/rules.js';
import { SUPPORTED_GRAPH_SCHEMA_VERSION } from '../../../src/graph/types.js';

const prov = { source: 'metadata' as const, capturedAt: '2026-09-07T00:00:00Z' };
const node = (over: Record<string, unknown>) => ({
  id: 'obj.Account', kind: 'sobject', layer: 'data', level: 2,
  parent: null, label: 'Account', attrs: {}, provenance: prov, ...over,
});
const doc = (nodes: unknown[], edges: unknown[] = []) => ({
  schemaVersion: SUPPORTED_GRAPH_SCHEMA_VERSION, capturedAt: '2026-09-07T00:00:00Z',
  orgId: '00Dxx0000000000', nodes, edges, coverage: { notes: [], unavailable: [] },
});
const codes = (d: unknown) => validateGraph(d).map((f) => f.code);

describe('validateGraph — semantic', () => {
  it('rejects a stored level that disagrees with the kind table', () => {
    expect(codes(doc([node({ level: 0 })]))).toContain(GRAPH_RULES.LEVEL_KIND_MISMATCH);
  });

  it('rejects a stored layer that disagrees with the kind table', () => {
    expect(codes(doc([node({ layer: 'access' })]))).toContain(GRAPH_RULES.LAYER_KIND_MISMATCH);
  });

  it('rejects an unknown kind', () => {
    expect(codes(doc([node({ kind: 'widget' })]))).toContain(GRAPH_RULES.UNKNOWN_KIND);
  });

  it('rejects an id that is not namespaced by kind', () => {
    expect(codes(doc([node({ id: 'Account' })]))).toContain(GRAPH_RULES.ID_NOT_NAMESPACED);
  });

  it('rejects duplicate ids', () => {
    expect(codes(doc([node({}), node({})]))).toContain(GRAPH_RULES.ID_DUPLICATE);
  });

  it('rejects a level 0 node that carries a parent', () => {
    const org = node({ id: 'org.root', kind: 'org', layer: 'landscape', level: 0, parent: 'obj.Account' });
    expect(codes(doc([org, node({})]))).toContain(GRAPH_RULES.ROOT_HAS_PARENT);
  });

  it('rejects a parent that does not resolve', () => {
    expect(codes(doc([node({ parent: 'domain.missing' })]))).toContain(GRAPH_RULES.PARENT_UNRESOLVED);
  });

  it('rejects a parent at the same or a higher level', () => {
    const a = node({ id: 'obj.A', parent: 'obj.B' });
    const b = node({ id: 'obj.B' });
    expect(codes(doc([a, b]))).toContain(GRAPH_RULES.LEVEL_PARENT_ORDER);
  });

  it('rejects a parent cycle', () => {
    // Same level, so LEVEL_PARENT_ORDER also fires; the cycle must be reported in its own right
    // because an order violation is repairable by renumbering and a cycle is not.
    const a = node({ id: 'fld.A', kind: 'field', level: 3, parent: 'fld.B' });
    const b = node({ id: 'fld.B', kind: 'field', level: 3, parent: 'fld.A' });
    expect(codes(doc([a, b]))).toContain(GRAPH_RULES.PARENT_CYCLE);
  });

  it('accepts a null parent above level 0 — unparented is reportable, not invalid', () => {
    // Spec section 2.3. An extracted node that has not been grouped renders as unattributed
    // rather than being assigned a plausible owner.
    expect(validateGraph(doc([node({ parent: null })]))).toEqual([]);
  });

  it('requires a derived edge to name its rule', () => {
    const e = {
      from: 'obj.Account', to: 'obj.Account', kind: 'relates', attrs: {},
      provenance: { source: 'derived', capturedAt: '2026-09-07T00:00:00Z' },
    };
    expect(codes(doc([node({})], [e]))).toContain(GRAPH_RULES.DERIVED_MISSING_RULE);
  });

  it('rejects an edge endpoint that does not resolve', () => {
    const e = { from: 'obj.Account', to: 'obj.Ghost', kind: 'relates', attrs: {}, provenance: prov };
    expect(codes(doc([node({})], [e]))).toContain(GRAPH_RULES.EDGE_ENDPOINT_UNRESOLVED);
  });
});
