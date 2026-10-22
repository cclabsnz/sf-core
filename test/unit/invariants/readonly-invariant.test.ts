import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ORG_WRITE_RULES,
  collectSourceFiles,
  fetchUsesNonGetMethod,
  filesUsingFetch,
  findInvariantViolations,
  formatViolations,
} from '../../../src/testing/invariants.js';

/**
 * Read-only invariant guard for @cclabsnz/sf-core.
 *
 * The product promise is that these tools are *strictly read-only*: SOQL / Tooling /
 * REST GET queries and Metadata reads only, never a mutation of the org they are pointed
 * at. This turns that promise into an enforced CI gate rather than a README claim.
 *
 * Each package runs this against its own `src/`, so no package can opt out by omission.
 */

const SRC_DIR = join(process.cwd(), 'src');

/**
 * `fetch()` is allowed only in these files. All org I/O funnels through the get-only ones.
 * The single token-post file authenticates (OAuth token exchange) and writes no org data.
 */
const FETCH_ALLOWLIST: Record<string, 'get-only' | 'token-post'> = {
  'api/RestClientImpl.ts': 'get-only',
  'api/fetch/FetchTransport.ts': 'get-only',
  'api/fetch/jwtBearer.ts': 'token-post',
};

describe('read-only invariant (core)', () => {
  it('scans a non-trivial number of source files', () => {
    // Guards against the scan silently matching nothing and the suite passing vacuously.
    expect(collectSourceFiles(SRC_DIR).length).toBeGreaterThan(20);
  });

  it('contains no org-mutating API calls anywhere in src/', () => {
    const violations = findInvariantViolations(SRC_DIR, ORG_WRITE_RULES);
    if (violations.length > 0) {
      throw new Error(
        'Read-only invariant violated — the following look like org writes:\n' +
          formatViolations(violations) +
          '\n\nThese tools must never mutate a target org. If this is a false positive, ' +
          'add an `// invariant:allow` comment on the line after review.',
      );
    }
  });

  it('uses fetch() only in allowlisted files, and only as a GET', () => {
    for (const rel of filesUsingFetch(SRC_DIR)) {
      expect(Object.keys(FETCH_ALLOWLIST)).toContain(rel);
      if (FETCH_ALLOWLIST[rel] === 'get-only') {
        expect(fetchUsesNonGetMethod(join(SRC_DIR, rel))).toBe(false);
      }
    }
  });

  it('confines the one non-GET request to the OAuth token exchange', () => {
    const tokenFiles = Object.entries(FETCH_ALLOWLIST).filter(([, mode]) => mode === 'token-post');
    expect(tokenFiles).toHaveLength(1);
    for (const [rel] of tokenFiles) {
      const src = readFileSync(join(SRC_DIR, rel), 'utf8');
      // Its fetch call carries an invariant:allow marker, so count call sites directly.
      const calls = src.split('\n').filter((line) => /\bfetch\s*\(/.test(line));
      expect(calls).toHaveLength(1);
      expect(src).toContain('/services/oauth2/token');
    }
    // Any other file that sends a POST is caught by ORG_WRITE_RULES above.
  });

  it('keeps get-only entries that exist free of non-GET methods', () => {
    for (const [rel, mode] of Object.entries(FETCH_ALLOWLIST)) {
      const file = join(SRC_DIR, rel);
      if (mode === 'get-only' && existsSync(file)) {
        expect(fetchUsesNonGetMethod(file)).toBe(false);
      }
    }
  });
});
