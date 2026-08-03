import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventBaselineStore } from '../../../src/events/EventBaselineStore.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-event-hourly-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('EventBaselineStore — hourly layout', () => {
  it('nests hourly captures under a date directory', () => {
    const store = new EventBaselineStore(tmpDir);
    expect(store.pathFor('00Dxx', 'AuraRequest', '2026-08-02', '0AT01', '04')).toBe(
      path.join(tmpDir, '00Dxx', 'AuraRequest', '2026-08-02', '04-0AT01.csv'),
    );
  });

  it('zero-pads the hour so lexical order matches chronological order', () => {
    const store = new EventBaselineStore(tmpDir);
    expect(store.pathFor('00Dxx', 'URI', '2026-08-02', '0AT01', '4')).toContain('04-0AT01.csv');
  });

  it('keeps the id in the path — one (type, hour) can hold several files', () => {
    const store = new EventBaselineStore(tmpDir);
    store.save('00Dxx', 'AuraRequest', '2026-08-02', '0ATaaa', 'a', '04');
    store.save('00Dxx', 'AuraRequest', '2026-08-02', '0ATbbb', 'b', '04');

    const dir = path.join(tmpDir, '00Dxx', 'AuraRequest', '2026-08-02');
    expect(fs.readdirSync(dir).sort()).toEqual(['04-0ATaaa.csv', '04-0ATbbb.csv']);
  });

  it('round-trips an hourly capture through save/has/pathFor', () => {
    const store = new EventBaselineStore(tmpDir);
    expect(store.has('00Dxx', 'Login', '2026-08-02', '0AT01', '04')).toBe(false);
    const saved = store.save('00Dxx', 'Login', '2026-08-02', '0AT01', 'body', '04');
    expect(store.has('00Dxx', 'Login', '2026-08-02', '0AT01', '04')).toBe(true);
    expect(fs.readFileSync(saved, 'utf-8')).toBe('body');
  });

  it('lets a daily and an hourly capture of the same type and date coexist', () => {
    // The daily form is a *file* named {date}-{id}.csv; the hourly form is a *directory*
    // named {date}. Nothing to migrate — pre-existing daily trees keep resolving.
    const store = new EventBaselineStore(tmpDir);
    store.save('00Dxx', 'Login', '2026-08-02', '0ATdaily', 'daily-body');
    store.save('00Dxx', 'Login', '2026-08-02', '0AThourly', 'hourly-body', '04');

    expect(store.has('00Dxx', 'Login', '2026-08-02', '0ATdaily')).toBe(true);
    expect(store.has('00Dxx', 'Login', '2026-08-02', '0AThourly', '04')).toBe(true);
    expect(fs.readFileSync(store.pathFor('00Dxx', 'Login', '2026-08-02', '0ATdaily'), 'utf-8')).toBe(
      'daily-body',
    );
  });

  it('resolves a daily tree written by the previous version', () => {
    // Fixture: exactly what an older release left on disk, laid down by hand.
    const legacy = path.join(tmpDir, '00Dxx', 'Login');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, '2026-07-07-0AT0001.csv'), 'legacy');

    const store = new EventBaselineStore(tmpDir);
    expect(store.has('00Dxx', 'Login', '2026-07-07', '0AT0001')).toBe(true);
  });
});

describe('EventBaselineStore — realtime NDJSON', () => {
  it('writes one JSON object per line under _realtime/{Object}/{date}/{HH}.ndjson', () => {
    const store = new EventBaselineStore(tmpDir);
    const rows = [{ EventIdentifier: 'a', RowsProcessed: 0 }, { EventIdentifier: 'b' }];
    const saved = store.saveRealtime('00Dxx', 'ListViewEvent', '2026-08-02', '4', rows);

    expect(saved).toBe(
      path.join(tmpDir, '00Dxx', '_realtime', 'ListViewEvent', '2026-08-02', '04.ndjson'),
    );
    const lines = fs.readFileSync(saved, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => JSON.parse(l))).toEqual(rows);
  });

  it('reports an empty file as not captured, so a truncated run is retried', () => {
    const store = new EventBaselineStore(tmpDir);
    const target = store.realtimePathFor('00Dxx', 'ApiEvent', '2026-08-02', '04');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '');

    expect(store.hasRealtime('00Dxx', 'ApiEvent', '2026-08-02', '04')).toBe(false);
    store.saveRealtime('00Dxx', 'ApiEvent', '2026-08-02', '04', [{ a: 1 }]);
    expect(store.hasRealtime('00Dxx', 'ApiEvent', '2026-08-02', '04')).toBe(true);
  });

  it('does not throw when the root is read-only', () => {
    fs.chmodSync(tmpDir, 0o444);
    const store = new EventBaselineStore(tmpDir);
    expect(() => store.saveRealtime('00Dxx', 'ApiEvent', '2026-08-02', '04', [{}])).not.toThrow();
    fs.chmodSync(tmpDir, 0o755);
  });
});

describe('EventBaselineStore — coverage manifests', () => {
  it('names coverage manifests distinctly from the legacy manifest files', () => {
    const store = new EventBaselineStore(tmpDir);
    const coverage = store.writeCoverageManifest('00Dxx', { orgId: '00Dxx' });
    const legacy = store.writeManifest('00Dxx', { orgId: '00Dxx' });

    expect(path.basename(coverage)).toMatch(/^coverage-\d+-[a-z0-9]+\.json$/);
    expect(path.basename(legacy)).toMatch(/^manifest-\d+-[a-z0-9]+\.json$/);
    expect(path.dirname(coverage)).toBe(path.join(tmpDir, '00Dxx', '_manifests'));
  });
});
