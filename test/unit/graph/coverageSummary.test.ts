import { describe, it, expect } from '@jest/globals';
import { summariseCoverage } from '../../../src/graph/coverage.js';

describe('summariseCoverage', () => {
  it('reports notes and unavailable scopes, naming what could not be read', () => {
    const lines = summariseCoverage({
      notes: ['connected apps not readable'],
      unavailable: [{ scope: 'landscape.connectedApps', reason: 'failed', detail: 'INSUFFICIENT_ACCESS' }],
    });
    expect(lines.some((l) => l.includes('connected apps not readable'))).toBe(true);
    expect(lines.some((l) => l.includes('landscape.connectedApps'))).toBe(true);
    expect(lines.some((l) => l.includes('INSUFFICIENT_ACCESS'))).toBe(true);
  });

  it('returns no lines for a clean document', () => {
    expect(summariseCoverage({ notes: [], unavailable: [] })).toEqual([]);
  });
});
