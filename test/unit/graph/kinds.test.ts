import { describe, it, expect } from '@jest/globals';
import { GRAPH_KIND_TABLE, levelOfKind, layerOfKind, ownerOfKind, type GraphNodeKind } from '../../../src/graph/kinds.js';

describe('GRAPH_KIND_TABLE', () => {
  it('makes level a pure function of kind', () => {
    expect(levelOfKind('sobject')).toBe(2);
    expect(levelOfKind('field')).toBe(3);
    expect(levelOfKind('org')).toBe(0);
    expect(levelOfKind('domain')).toBe(1);
  });

  it('puts connected apps and named credentials at level 2, not level 0', () => {
    // Landscape is not level 0. Level 0 is the coarsest rollup; a connected app is a
    // concrete entity, exactly like an SObject. Spec section 2.2.
    expect(layerOfKind('connectedApp')).toBe('landscape');
    expect(levelOfKind('connectedApp')).toBe(2);
    expect(layerOfKind('namedCredential')).toBe('landscape');
    expect(levelOfKind('namedCredential')).toBe(2);
  });

  it('spans multiple levels within a single layer', () => {
    const landscapeLevels = new Set(
      Object.values(GRAPH_KIND_TABLE)
        .filter((e) => e.layer === 'landscape')
        .map((e) => e.level),
    );
    expect(landscapeLevels.size).toBeGreaterThan(1);
  });

  it('keeps level 0 small enough to present as-is', () => {
    const levelZeroKinds = Object.values(GRAPH_KIND_TABLE).filter((e) => e.level === 0);
    expect(levelZeroKinds.length).toBeLessThanOrEqual(3);
  });
});

describe('kind ownership', () => {
  it('declares exactly one producer for every kind', () => {
    // The merge enforces the split from this table, so a kind with no owner is a kind two
    // producers can both emit -- which is the id collision the merge exists to prevent.
    for (const kind of Object.keys(GRAPH_KIND_TABLE) as GraphNodeKind[]) {
      expect(['orgviz', 'orgintel']).toContain(ownerOfKind(kind));
    }
  });

  it('gives sf-orgintel the process and runtime kinds it parses', () => {
    // sf-orgviz extraction reads no Flow XML and no Apex. Every kind here exists because
    // sf-orgintel's map command parses it.
    expect(ownerOfKind('flow')).toBe('orgintel');
    expect(ownerOfKind('apexClass')).toBe('orgintel');
    expect(ownerOfKind('trigger')).toBe('orgintel');
    expect(ownerOfKind('execution')).toBe('orgintel');
    expect(ownerOfKind('flowElement')).toBe('orgintel');
  });

  it('gives sf-orgviz the kinds its extraction produces', () => {
    expect(ownerOfKind('sobject')).toBe('orgviz');
    expect(ownerOfKind('field')).toBe('orgviz');
    expect(ownerOfKind('permissionSet')).toBe('orgviz');
    expect(ownerOfKind('profile')).toBe('orgviz');
    expect(ownerOfKind('user')).toBe('orgviz');
    expect(ownerOfKind('org')).toBe('orgviz');
    expect(ownerOfKind('connectedApp')).toBe('orgviz');
    expect(ownerOfKind('namedCredential')).toBe('orgviz');
  });
});
