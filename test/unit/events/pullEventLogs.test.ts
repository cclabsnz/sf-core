import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventBaselineStore } from '../../../src/events/EventBaselineStore.js';
import { pullEventLogs, type EventLogFileRow } from '../../../src/events/pullEventLogs.js';
import { readCoverageManifest } from '../../../src/events/CaptureManifest.js';
import { HOURLY_FORENSIC_CORE } from '../../../src/events/eventLogQuery.js';
import type { SoqlClient } from '../../../src/api/SoqlClient.js';
import type { RestClient } from '../../../src/api/RestClient.js';

let tmpDir: string;
let emittedSoql: string[];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-pull-test-'));
  emittedSoql = [];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * `rowsFor` is called with each emitted SOQL so a test can vary the answer per pass — which is
 * how the Daily/Hourly split is asserted.
 */
function makeDeps(
  rowsFor: (soql: string) => EventLogFileRow[] | Error,
  downloadFor?: (id: string) => number | Error,
) {
  const soql = {
    async query<T>(): Promise<{ totalSize: number; done: boolean; records: T[] }> {
      throw new Error('not used');
    },
    async queryAll<T>(s: string): Promise<T[]> {
      emittedSoql.push(s);
      const answer = rowsFor(s);
      if (answer instanceof Error) throw answer;
      return answer as T[];
    },
  } satisfies SoqlClient;

  const rest = {
    async get<T>(): Promise<T> {
      throw new Error('not used');
    },
    async getRaw(): Promise<string> {
      throw new Error('not used');
    },
    async getRawToFile(p: string, dest: string): Promise<number> {
      const id = /EventLogFile\/([^/]+)\//.exec(p)?.[1] ?? '';
      const answer = downloadFor ? downloadFor(id) : 100;
      if (answer instanceof Error) throw answer;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, 'x'.repeat(answer));
      return answer;
    },
  } satisfies RestClient;

  return { soql, rest, store: new EventBaselineStore(tmpDir), orgId: '00Dxx' };
}

const dailyRow = (id: string, type = 'Login'): EventLogFileRow => ({
  Id: id,
  EventType: type,
  LogDate: '2026-08-01T00:00:00.000+0000',
  Interval: 'Daily',
  LogFileLength: 100,
});

const hourlyRow = (id: string, hour = '04', type = 'AuraRequest'): EventLogFileRow => ({
  Id: id,
  EventType: type,
  LogDate: `2026-08-02T${hour}:00:00.000+0000`,
  Interval: 'Hourly',
  LogFileLength: 100,
});

describe('pullEventLogs — backward compatibility', () => {
  it('still pulls daily logs into the unchanged path layout', async () => {
    const deps = makeDeps(() => [dailyRow('0AT001')]);
    const result = await pullEventLogs(deps, { since: 7 });

    expect(result.interval).toBe('Daily');
    expect(result.downloaded).toBe(1);
    expect(result.logs[0].savedPath).toBe(
      path.join(tmpDir, '00Dxx', 'Login', '2026-08-01-0AT001.csv'),
    );
    expect(result.logs[0].hour).toBeUndefined();
    expect(emittedSoql[0]).toContain("Interval = 'Daily'");
  });

  it('skips a file already on disk', async () => {
    const deps = makeDeps(() => [dailyRow('0AT001')]);
    deps.store.save('00Dxx', 'Login', '2026-08-01', '0AT001', 'already here');

    const result = await pullEventLogs(deps, { since: 7 });
    expect(result).toMatchObject({ skipped: 1, downloaded: 0 });
    expect(result.coverage.elf.skipped[0]).toMatchObject({ reason: 'already-captured' });
  });

  it('re-downloads a file already on disk when forced', async () => {
    const deps = makeDeps(() => [dailyRow('0AT001')]);
    deps.store.save('00Dxx', 'Login', '2026-08-01', '0AT001', 'stale');

    const result = await pullEventLogs(deps, { since: 7, force: true });
    expect(result).toMatchObject({ skipped: 0, downloaded: 1 });
  });
});

describe('pullEventLogs — hourly', () => {
  it('derives the hour from LogDate and nests the capture under a date directory', async () => {
    const deps = makeDeps(() => [hourlyRow('0AT002')]);
    const result = await pullEventLogs(deps, { since: 1, interval: 'Hourly' });

    expect(result.logs[0]).toMatchObject({ hour: '04', interval: 'Hourly' });
    expect(result.logs[0].savedPath).toBe(
      path.join(tmpDir, '00Dxx', 'AuraRequest', '2026-08-02', '04-0AT002.csv'),
    );
  });

  it('defaults hourly capture to the forensic core rather than every type', async () => {
    const deps = makeDeps(() => []);
    await pullEventLogs(deps, { since: 1, interval: 'Hourly' });

    for (const type of HOURLY_FORENSIC_CORE) expect(emittedSoql[0]).toContain(`'${type}'`);
  });

  it('lets an explicit type list override the forensic-core default', async () => {
    const deps = makeDeps(() => []);
    await pullEventLogs(deps, { since: 1, interval: 'Hourly', types: ['Login'] });

    expect(emittedSoql[0]).toContain("EventType IN ('Login')");
    expect(emittedSoql[0]).not.toContain('AuraRequest');
  });

  it('captures two files for the same type and hour without collision', async () => {
    const deps = makeDeps(() => [hourlyRow('0ATaaa'), hourlyRow('0ATbbb')]);
    const result = await pullEventLogs(deps, { since: 1, interval: 'Hourly' });

    expect(result.downloaded).toBe(2);
    expect(new Set(result.logs.map((l) => l.savedPath)).size).toBe(2);
  });
});

describe("pullEventLogs — interval 'both'", () => {
  it('runs two passes, so daily takes every type while hourly takes the forensic core', async () => {
    // One SOQL statement cannot carry two different EventType filters; this is why the
    // orchestrator splits rather than relying on a single predicate-free query.
    const deps = makeDeps((s) => (s.includes("Interval = 'Daily'") ? [dailyRow('0AT001')] : [hourlyRow('0AT002')]));
    const result = await pullEventLogs(deps, { since: 1, interval: 'both' });

    expect(emittedSoql).toHaveLength(2);
    expect(emittedSoql[0]).toContain("Interval = 'Daily'");
    expect(emittedSoql[0]).not.toContain('EventType IN');
    expect(emittedSoql[1]).toContain("Interval = 'Hourly'");
    expect(emittedSoql[1]).toContain("'AuraRequest'");

    expect(result.downloaded).toBe(2);
    expect(result.logs.map((l) => l.interval).sort()).toEqual(['Daily', 'Hourly']);
  });

  it('keeps capturing the other interval when one pass is inaccessible', async () => {
    const deps = makeDeps((s) =>
      s.includes("Interval = 'Hourly'")
        ? new Error('INSUFFICIENT_ACCESS: no permission to view event log files')
        : [dailyRow('0AT001')],
    );

    const result = await pullEventLogs(deps, { since: 1, interval: 'both' });

    expect(result.downloaded).toBe(1);
    expect(result.accessError).toBe('no-permission');
    expect(result.coverage.accessErrors[0].scope).toBe('EventLogFile:Hourly');
  });
});

describe('pullEventLogs — coverage manifest', () => {
  it('writes a manifest even when nothing at all was captured', async () => {
    // Without this, "no data" and "never looked" are indistinguishable downstream — which is
    // the entire reason the coverage manifest exists.
    const deps = makeDeps(() => []);
    const result = await pullEventLogs(deps, { since: 7 });

    expect(result.downloaded).toBe(0);
    expect(result.manifestPath).not.toBe('');
    expect(fs.existsSync(result.manifestPath)).toBe(true);

    const onDisk = readCoverageManifest(result.manifestPath);
    expect(onDisk).toMatchObject({ orgId: '00Dxx', interval: 'Daily' });
    expect(onDisk?.elf.captured).toEqual([]);
  });

  it('writes a manifest when the query itself failed', async () => {
    const deps = makeDeps(() => new Error("sObject type 'EventLogFile' is not supported"));
    const result = await pullEventLogs(deps, { since: 7 });

    expect(result.accessError).toBe('not-enabled');
    expect(readCoverageManifest(result.manifestPath)?.accessErrors[0]).toMatchObject({
      scope: 'EventLogFile:Daily',
      reason: 'not-enabled',
    });
  });

  it('records the window it was asked for', async () => {
    const window = { from: '2026-08-02T04:00:00Z', to: '2026-08-02T05:00:00Z' };
    const deps = makeDeps(() => []);
    const result = await pullEventLogs(deps, { window, interval: 'Hourly' });

    expect(result.coverage.window).toEqual(window);
    expect(emittedSoql[0]).toContain('LogDate >= 2026-08-02T04:00:00Z');
  });

  it('records a download failure without aborting the remaining files', async () => {
    const deps = makeDeps(
      () => [dailyRow('0ATbad'), dailyRow('0ATgood')],
      (id) => (id === '0ATbad' ? new Error('502 Bad Gateway') : 42),
    );
    const warnings: string[] = [];

    const result = await pullEventLogs(deps, { since: 7, warn: (m) => warnings.push(m) });

    expect(result).toMatchObject({ failed: 1, downloaded: 1, totalBytes: 42 });
    expect(result.coverage.elf.failed[0]).toMatchObject({ id: '0ATbad', reason: 'download-failed' });
    expect(warnings).toHaveLength(1);
  });

  it('skips an oversized blob as too-large without downloading it', async () => {
    const deps = makeDeps(
      () => [{ ...dailyRow('0ATbig'), LogFileLength: 5_000 }],
      () => new Error('should never be downloaded'),
    );

    const result = await pullEventLogs(deps, { since: 7, maxFileBytes: 1_000 });

    expect(result).toMatchObject({ skipped: 1, downloaded: 0, failed: 0 });
    expect(result.coverage.elf.skipped[0]).toMatchObject({ reason: 'too-large' });
    expect(result.coverage.elf.skipped[0].detail).toContain('5000 bytes');
  });
});

describe('pullEventLogs — realtime', () => {
  it('records an access error rather than throwing when realtime is asked for without a window', async () => {
    const deps = makeDeps(() => []);
    const result = await pullEventLogs(deps, { since: 1, realtime: true });

    expect(result.coverage.accessErrors[0]).toMatchObject({ scope: 'RealtimeEvents' });
    expect(result.coverage.rte.captured).toEqual([]);
  });

  it('captures RTE alongside ELF and folds the outcome into the manifest', async () => {
    const deps = makeDeps(() => [hourlyRow('0AT002')]);
    // Route describe/query for the RTE probe through the same mock surface.
    deps.rest.get = (async () => ({ fields: [{ name: 'EventDate' }] })) as RestClient['get'];
    const baseQueryAll = deps.soql.queryAll.bind(deps.soql);
    deps.soql.queryAll = (async (s: string) =>
      s.includes('ListViewEvent')
        ? [{ EventDate: '2026-08-02T04:21:56.000Z' }]
        : baseQueryAll(s)) as SoqlClient['queryAll'];

    const result = await pullEventLogs(deps, {
      window: { from: '2026-08-02T04:00:00Z', to: '2026-08-02T05:00:00Z' },
      interval: 'Hourly',
      realtime: true,
      rteCatalog: [{ base: 'ListViewEvent', preferredFields: ['EventDate'] }],
    });

    expect(result.downloaded).toBe(1);
    expect(result.coverage.rte.captured[0]).toMatchObject({ object: 'ListViewEvent', rows: 1 });
    expect(readCoverageManifest(result.manifestPath)?.rte.captured).toHaveLength(1);
  });
});
