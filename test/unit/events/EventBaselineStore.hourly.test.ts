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

describe('EventBaselineStore — capture integrity', () => {
  it('treats a zero-byte file as not captured, so a killed run is retried', () => {
    // A run killed between create and write leaves an empty file. Counting that as captured
    // would retire the row permanently: every later run skips it and no manifest records a gap.
    const store = new EventBaselineStore(tmpDir);
    const target = store.pathFor('00Dxx', 'Login', '2026-08-02', '0AT01');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '');

    expect(store.has('00Dxx', 'Login', '2026-08-02', '0AT01')).toBe(false);
  });

  it('leaves no temporary file behind after a successful write', () => {
    const store = new EventBaselineStore(tmpDir);
    store.save('00Dxx', 'Login', '2026-08-02', '0AT01', 'body');
    const dir = path.join(tmpDir, '00Dxx', 'Login');
    expect(fs.readdirSync(dir)).toEqual(['2026-08-02-0AT01.csv']);
  });

  it('never publishes a partial file — the final path appears only once complete', () => {
    const store = new EventBaselineStore(tmpDir);
    const target = store.realtimePathFor('00Dxx', 'ApiEvent', '2026-08-02', '04');
    const seen: boolean[] = [];

    // Observe the destination while the body is being serialised. With a direct write the
    // path would already exist and be short; with rename it cannot exist at all yet.
    const rows = Array.from({ length: 50 }, (_, i) => ({
      i,
      get watch() {
        seen.push(fs.existsSync(target));
        return 1;
      },
    }));
    store.saveRealtime('00Dxx', 'ApiEvent', '2026-08-02', '04', rows);

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some(Boolean)).toBe(false);
    expect(fs.readFileSync(target, 'utf-8').trim().split('\n')).toHaveLength(50);
  });
});

describe('EventBaselineStore — path segment safety', () => {
  it('cannot be walked out of the store root by a hostile EventType', () => {
    const store = new EventBaselineStore(tmpDir);
    const escaped = store.pathFor('00Dxx', '../../../../etc', '2026-08-02', 'passwd');

    // The separators are what make a traversal; the dots alone are just an odd directory
    // name. So the property under test is containment, not the absence of '..' characters.
    expect(path.resolve(escaped).startsWith(path.resolve(tmpDir) + path.sep)).toBe(true);
    expect(path.relative(tmpDir, escaped).split(path.sep)).toEqual([
      '00Dxx',
      '.._.._.._.._etc',
      '2026-08-02-passwd.csv',
    ]);
  });

  it.each([
    ['orgId', (s: EventBaselineStore) => s.pathFor('../../evil', 'Login', '2026-08-02', 'x')],
    ['logDate', (s: EventBaselineStore) => s.pathFor('00Dxx', 'Login', '../..', 'x')],
    ['id', (s: EventBaselineStore) => s.pathFor('00Dxx', 'Login', '2026-08-02', '../../x')],
    ['object', (s: EventBaselineStore) => s.realtimePathFor('00Dxx', '../../x', '2026-08-02', '04')],
  ])('confines a traversal attempt in %s', (_label, build) => {
    const store = new EventBaselineStore(tmpDir);
    const p = build(store);
    expect(path.resolve(p).startsWith(path.resolve(tmpDir) + path.sep)).toBe(true);
  });

  it('keeps ordinary Salesforce identifiers untouched', () => {
    const store = new EventBaselineStore(tmpDir);
    expect(store.pathFor('00Dxx0000000000EAA', 'AuraRequest', '2026-08-02', '0ATxx01')).toBe(
      path.join(tmpDir, '00Dxx0000000000EAA', 'AuraRequest', '2026-08-02-0ATxx01.csv'),
    );
  });
});
