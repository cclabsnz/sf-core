import { join } from 'node:path';
import {
  SECURE_FS_RULES,
  findInvariantViolations,
  formatViolations,
} from '../../../src/testing/invariants.js';

const SRC_DIR = join(process.cwd(), 'src');

describe('secure-fs invariant (sf-core)', () => {
  it('forbids raw un-moded filesystem writes outside secureFs', () => {
    const violations = findInvariantViolations(SRC_DIR, SECURE_FS_RULES);
    if (violations.length > 0) {
      throw new Error(
        'Secure-fs invariant violated — persistent local store writes must use secureFs:\n' +
          formatViolations(violations) +
          '\n\nAll writes to ~/.sf/ directories must enforce 0700 on directories and 0600 on files. ' +
          'Use `secureFs.mkdirSync`, `secureFs.writeFileSync`, or `secureFs.createWriteStream`. ' +
          'If this is a false positive, add an `// invariant:allow` comment on the line after review.',
      );
    }
  });
});
