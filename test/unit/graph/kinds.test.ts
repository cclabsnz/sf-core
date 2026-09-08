import { describe, it, expect } from '@jest/globals';
import { KIND_TABLE, levelOf, layerOf } from '../../../src/graph/kinds.js';

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
