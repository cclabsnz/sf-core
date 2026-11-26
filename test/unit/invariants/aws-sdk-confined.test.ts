import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectSourceFiles } from '../../../src/testing/invariants.js';

/**
 * The AWS SDK is an optional peer. Exactly one source file may name it, and only through a
 * dynamic import, so importing `@cclabsnz/sf-core/storage` never loads the SDK.
 */
const SRC_DIR = join(process.cwd(), 'src');
const ALLOWED = 'src/storage/S3ObjectStoreImpl.ts';

describe('aws-sdk confinement', () => {
  const files = collectSourceFiles(SRC_DIR).map((f) => ({
    rel: relative(process.cwd(), f).split('\\').join('/'),
    text: readFileSync(f, 'utf8'),
  }));

  it('only S3ObjectStoreImpl.ts references @aws-sdk', () => {
    const offenders = files.filter((f) => /['"]@aws-sdk\//.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([ALLOWED]);
  });

  it('that file imports the SDK dynamically, never statically', () => {
    const text = files.find((f) => f.rel === ALLOWED)?.text ?? '';
    expect(text).toMatch(/await import\(\s*['"]@aws-sdk\//);
    expect(text).not.toMatch(/^\s*(?:import|export)\s[^;]*?from\s*['"]@aws-sdk\//m);
    expect(text).not.toMatch(/^\s*import\s*['"]@aws-sdk\//m);
  });
});
