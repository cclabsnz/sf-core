import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  SKIP_REASONS,
  emptyCoverage,
  isSkipReason,
  readCoverageManifest,
  type CaptureCoverage,
} from '../../../src/events/CaptureManifest.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-manifest-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SkipReason', () => {
  it('keeps the licence / storage / permission distinctions apart', () => {
    // A consumer that cannot tell these three apart cannot honestly say whether an empty
    // result means nothing happened.
    for (const reason of ['unlicensed', 'storage-disabled', 'no-permission'] as const) {
      expect(SKIP_REASONS).toContain(reason);
    }
  });

  it('is a closed set', () => {
    expect(isSkipReason('too-large')).toBe(true);
    expect(isSkipReason('probably-fine')).toBe(false);
    expect(isSkipReason(undefined)).toBe(false);
  });
});

describe('readCoverageManifest', () => {
  it('round-trips a coverage record', () => {
    const coverage: CaptureCoverage = {
      ...emptyCoverage('00Dxx0000000000EAA', 'Hourly', '2026-08-03T02:15:00Z'),
      window: { from: '2026-08-02T04:00:00Z', to: '2026-08-02T05:00:00Z' },
    };
    coverage.elf.captured.push({
      type: 'AuraRequest',
      id: '0ATOZ',
      logDate: '2026-08-02',
      hour: '04',
      bytes: 1_001_613,
      path: '/tmp/x.csv',
    });
    coverage.rte.unavailable.push({
      object: 'GuestUserAnomalyEvent',
      reason: 'storage-disabled',
      detail: 'base not queryable; GuestUserAnomalyEventStore returned 0 rows',
    });

    const file = path.join(tmpDir, 'coverage-1.json');
    fs.writeFileSync(file, JSON.stringify(coverage));

    expect(readCoverageManifest(file)).toEqual(coverage);
  });

  it('every reason it carries is in the closed enum', () => {
    const coverage = emptyCoverage('00Dxx', 'Daily', '2026-08-03T00:00:00Z');
    coverage.elf.skipped.push({ type: 'URI', reason: 'already-captured' });
    coverage.elf.failed.push({ type: 'Login', reason: 'download-failed' });
    coverage.rte.unavailable.push({ object: 'FileEvent', reason: 'unlicensed' });

    const reasons = [
      ...coverage.elf.skipped.map((s) => s.reason),
      ...coverage.elf.failed.map((s) => s.reason),
      ...coverage.rte.unavailable.map((s) => s.reason),
    ];
    expect(reasons.every(isSkipReason)).toBe(true);
  });

  it('returns undefined on a malformed file instead of aborting a directory scan', () => {
    const bad = path.join(tmpDir, 'coverage-bad.json');
    fs.writeFileSync(bad, '{ not json');
    expect(readCoverageManifest(bad)).toBeUndefined();
    expect(readCoverageManifest(path.join(tmpDir, 'missing.json'))).toBeUndefined();
  });

  it('rejects a JSON file that is not a coverage record', () => {
    const wrong = path.join(tmpDir, 'other.json');
    fs.writeFileSync(wrong, JSON.stringify({ hello: 'world' }));
    expect(readCoverageManifest(wrong)).toBeUndefined();
  });
});
