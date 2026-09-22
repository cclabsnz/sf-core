import { describe, it, expect } from '@jest/globals';
import * as pkg from '../../../src/index.js';

describe('activity engine exports', () => {
  it('exposes every engine function at the package root', () => {
    for (const name of [
      'parseCsv', 'classify', 'normalise', 'isSupportedEventType',
      'decomposeComposite', 'sessionise', 'countKinds', 'segmentCycles',
      'flagOutliers', 'median', 'discoverMotif', 'stepLabel',
    ]) {
      expect(typeof (pkg as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('exposes the supported event type list', () => {
    expect(Array.isArray((pkg as Record<string, unknown>).SUPPORTED_EVENT_TYPES)).toBe(true);
  });
});
