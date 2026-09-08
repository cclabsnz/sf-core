// test/unit/graph/rules.test.ts
// A rule code is an API: anything keying off validator or merge output breaks when one changes.
// This test exists so a rename shows up as a failure here rather than in a consumer.
import { describe, it, expect } from '@jest/globals';
import { RULES } from '../../../src/graph/rules.js';

describe('merge rule codes', () => {
  it('names every merge rejection with a stable code', () => {
    expect(RULES.MERGE_ORG_MISMATCH).toBe('GRAPH_MERGE_ORG_MISMATCH');
    expect(RULES.MERGE_SCHEMA_VERSION_MISMATCH).toBe('GRAPH_MERGE_SCHEMA_VERSION_MISMATCH');
    expect(RULES.MERGE_ID_COLLISION).toBe('GRAPH_MERGE_ID_COLLISION');
    expect(RULES.MERGE_KIND_NOT_OWNED).toBe('GRAPH_MERGE_KIND_NOT_OWNED');
    expect(RULES.MERGE_CONTRIBUTION_UNRESOLVED).toBe('GRAPH_MERGE_CONTRIBUTION_UNRESOLVED');
  });

  it('keeps every code globally unique', () => {
    const codes = Object.values(RULES);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
