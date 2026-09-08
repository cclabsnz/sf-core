import { describe, it, expect } from '@jest/globals';
import { KIND_TABLE, levelOf, layerOf, ownerOf, type NodeKind } from '../../../src/graph/kinds.js';

describe('KIND_TABLE', () => {
  it('makes level a pure function of kind', () => {
    expect(levelOf('sobject')).toBe(2);
    expect(levelOf('field')).toBe(3);
    expect(levelOf('org')).toBe(0);
    expect(levelOf('domain')).toBe(1);
  });

  it('puts connected apps and named credentials at level 2, not level 0', () => {
    // Landscape is not level 0. Level 0 is the coarsest rollup; a connected app is a
    // concrete entity, exactly like an SObject. Spec section 2.2.
    expect(layerOf('connectedApp')).toBe('landscape');
    expect(levelOf('connectedApp')).toBe(2);
    expect(layerOf('namedCredential')).toBe('landscape');
    expect(levelOf('namedCredential')).toBe(2);
  });

  it('spans multiple levels within a single layer', () => {
    const landscapeLevels = new Set(
      Object.values(KIND_TABLE)
        .filter((e) => e.layer === 'landscape')
        .map((e) => e.level),
    );
    expect(landscapeLevels.size).toBeGreaterThan(1);
  });

  it('keeps level 0 small enough to present as-is', () => {
    const levelZeroKinds = Object.values(KIND_TABLE).filter((e) => e.level === 0);
    expect(levelZeroKinds.length).toBeLessThanOrEqual(3);
  });
});

describe('kind ownership', () => {
  it('declares exactly one producer for every kind', () => {
    // The merge enforces the split from this table, so a kind with no owner is a kind two
    // producers can both emit -- which is the id collision the merge exists to prevent.
    for (const kind of Object.keys(KIND_TABLE) as NodeKind[]) {
      expect(['orgviz', 'orgintel']).toContain(ownerOf(kind));
    }
  });

  it('gives sf-orgintel the process and runtime kinds it parses', () => {
    // sf-orgviz extraction reads no Flow XML and no Apex. Every kind here exists because
    // sf-orgintel's map command parses it.
    expect(ownerOf('flow')).toBe('orgintel');
    expect(ownerOf('apexClass')).toBe('orgintel');
    expect(ownerOf('trigger')).toBe('orgintel');
    expect(ownerOf('execution')).toBe('orgintel');
    expect(ownerOf('flowElement')).toBe('orgintel');
  });

  it('gives sf-orgviz the kinds its extraction produces', () => {
    expect(ownerOf('sobject')).toBe('orgviz');
    expect(ownerOf('field')).toBe('orgviz');
    expect(ownerOf('permissionSet')).toBe('orgviz');
    expect(ownerOf('profile')).toBe('orgviz');
    expect(ownerOf('user')).toBe('orgviz');
    expect(ownerOf('org')).toBe('orgviz');
    expect(ownerOf('connectedApp')).toBe('orgviz');
    expect(ownerOf('namedCredential')).toBe('orgviz');
  });
});
