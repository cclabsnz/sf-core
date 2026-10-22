import * as root from '../../../src/index.js';
import * as fetchEntry from '../../../src/fetch.js';

describe('public API error surface', () => {
  it.each([
    ['the root entry', root as Record<string, unknown>],
    ['./fetch', fetchEntry as Record<string, unknown>],
  ])('%s exports SalesforceApiError and isApiError but not the internal helpers', (_name, entry) => {
    expect(typeof entry.SalesforceApiError).toBe('function');
    expect(typeof entry.isApiError).toBe('function');
    expect(entry.apiErrorFromResponse).toBeUndefined();
    expect(entry.normaliseApiError).toBeUndefined();
  });
});
