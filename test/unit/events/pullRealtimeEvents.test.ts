import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventBaselineStore } from '../../../src/events/EventBaselineStore.js';
import {
  buildRealtimeQuery,
  classifyRteError,
  pullRealtimeEvents,
} from '../../../src/events/pullRealtimeEvents.js';
import type { RteType } from '../../../src/events/rteCatalog.js';
import { RTE_CATALOG } from '../../../src/events/rteCatalog.js';
import type { SoqlClient } from '../../../src/api/SoqlClient.js';
import type { RestClient } from '../../../src/api/RestClient.js';

const WINDOW = { from: '2026-08-02T04:00:00Z', to: '2026-08-02T05:00:00Z' };

let tmpDir: string;
let emittedSoql: string[];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-rte-test-'));
  emittedSoql = [];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Mock clients: describe answers from `fields`, query answers from `rows`, both by object name. */
function makeDeps(opts: {
  fields: Record<string, string[] | Error>;
  rows: Record<string, Array<Record<string, unknown>> | Error>;
}) {
  const rest = {
    async get<T>(p: string): Promise<T> {
      const name = /\/sobjects\/([^/]+)\/describe/.exec(p)?.[1] ?? '';
      const entry = opts.fields[name];
      if (entry === undefined) throw new Error(`sObject type '${name}' is not supported`);
      if (entry instanceof Error) throw entry;
      return { fields: entry.map((f) => ({ name: f })) } as T;
    },
    async getRaw(): Promise<string> {
      throw new Error('not used');
    },
    async getRawToFile(): Promise<number> {
      throw new Error('not used');
    },
  } satisfies RestClient;

  const soql = {
    async query<T>(): Promise<{ totalSize: number; done: boolean; records: T[] }> {
      throw new Error('not used');
    },
    async queryAll<T>(s: string): Promise<T[]> {
      emittedSoql.push(s);
      const name = /FROM (\w+)/.exec(s)?.[1] ?? '';
      const entry = opts.rows[name];
      if (entry instanceof Error) throw entry;
      return (entry ?? []) as T[];
    },
  } satisfies SoqlClient;

  return { soql, rest, store: new EventBaselineStore(tmpDir), orgId: '00Dxx' };
}

const LIST_VIEW: RteType = {
  base: 'ListViewEvent',
  preferredFields: ['EventDate', 'SourceIp', 'RowsProcessed', 'Records'],
};
const GUEST_ANOMALY: RteType = {
  base: 'GuestUserAnomalyEvent',
  store: 'GuestUserAnomalyEventStore',
  preferredFields: ['EventDate', 'SourceIp', 'RowsProcessed'],
};

describe('pullRealtimeEvents', () => {
  it('captures via the base object when it is queryable', async () => {
    const deps = makeDeps({
      fields: { ListViewEvent: ['EventDate', 'SourceIp', 'RowsProcessed', 'Records'] },
      rows: {
        ListViewEvent: [
          { EventDate: '2026-08-02T04:21:56.000Z', RowsProcessed: 0, Records: '' },
          { EventDate: '2026-08-02T04:22:01.000Z', RowsProcessed: 0, Records: '' },
        ],
      },
    });

    const result = await pullRealtimeEvents(deps, { window: WINDOW, catalog: [LIST_VIEW] });

    expect(result.captured).toEqual([
      {
        object: 'ListViewEvent',
        rows: 2,
        via: 'base',
        paths: [deps.store.realtimePathFor('00Dxx', 'ListViewEvent', '2026-08-02', '04')],
      },
    ]);
    expect(result.unavailable).toEqual([]);
  });

  it('falls back to the Store when the base object does not support query', async () => {
    const deps = makeDeps({
      fields: {
        GuestUserAnomalyEvent: ['EventDate', 'SourceIp', 'RowsProcessed'],
        GuestUserAnomalyEventStore: ['EventDate', 'SourceIp', 'RowsProcessed'],
      },
      rows: {
        GuestUserAnomalyEvent: new Error('entity type GuestUserAnomalyEvent does not support query'),
        GuestUserAnomalyEventStore: [{ EventDate: '2026-08-02T04:30:00.000Z' }],
      },
    });

    const result = await pullRealtimeEvents(deps, { window: WINDOW, catalog: [GUEST_ANOMALY] });

    expect(result.captured).toHaveLength(1);
    expect(result.captured[0]).toMatchObject({ object: 'GuestUserAnomalyEvent', rows: 1, via: 'store' });
  });

  it('records storage-disabled when only the Store answers and it is empty', async () => {
    // Empty and never-retained are indistinguishable from here, so this must NOT be reported
    // as "nothing happened".
    const deps = makeDeps({
      fields: {
        GuestUserAnomalyEvent: ['EventDate'],
        GuestUserAnomalyEventStore: ['EventDate'],
      },
      rows: {
        GuestUserAnomalyEvent: new Error('entity type GuestUserAnomalyEvent does not support query'),
        GuestUserAnomalyEventStore: [],
      },
    });

    const result = await pullRealtimeEvents(deps, { window: WINDOW, catalog: [GUEST_ANOMALY] });

    expect(result.captured).toEqual([]);
    expect(result.unavailable[0]).toMatchObject({
      object: 'GuestUserAnomalyEvent',
      reason: 'storage-disabled',
    });
    expect(result.unavailable[0].detail).toContain('does not support query');
  });

  it('records a queryable base returning nothing as a capture of zero rows', async () => {
    // The live channel answered and had nothing — a real finding, not a gap in capture.
    const deps = makeDeps({ fields: { ListViewEvent: ['EventDate'] }, rows: { ListViewEvent: [] } });
    const result = await pullRealtimeEvents(deps, { window: WINDOW, catalog: [LIST_VIEW] });

    expect(result.unavailable).toEqual([]);
    expect(result.captured).toEqual([
      { object: 'ListViewEvent', rows: 0, via: 'base', paths: [] },
    ]);
  });

  it('reports unlicensed when the object is absent from describe', async () => {
    const deps = makeDeps({ fields: {}, rows: {} });
    const result = await pullRealtimeEvents(deps, { window: WINDOW, catalog: [LIST_VIEW] });

    expect(result.unavailable[0]).toMatchObject({ object: 'ListViewEvent', reason: 'unlicensed' });
  });

  it('reports not-queryable when neither base nor Store accepts a query', async () => {
    const deps = makeDeps({
      fields: { GuestUserAnomalyEvent: ['EventDate'], GuestUserAnomalyEventStore: ['EventDate'] },
      rows: {
        GuestUserAnomalyEvent: new Error('entity type GuestUserAnomalyEvent does not support query'),
        GuestUserAnomalyEventStore: new Error(
          'entity type GuestUserAnomalyEventStore does not support query',
        ),
      },
    });

    const result = await pullRealtimeEvents(deps, { window: WINDOW, catalog: [GUEST_ANOMALY] });
    expect(result.unavailable[0]).toMatchObject({ reason: 'not-queryable' });
  });

  it('drops a preferred field the object does not define, without failing', async () => {
    // LightningUriEvent has no RowsProcessed; a fixed SELECT list across objects would fail.
    const deps = makeDeps({
      fields: { ListViewEvent: ['EventDate', 'SourceIp'] },
      rows: { ListViewEvent: [{ EventDate: '2026-08-02T04:00:00.000Z' }] },
    });

    const result = await pullRealtimeEvents(deps, { window: WINDOW, catalog: [LIST_VIEW] });

    expect(result.captured).toHaveLength(1);
    expect(emittedSoql[0]).toBe(
      'SELECT EventDate, SourceIp FROM ListViewEvent ' +
        'WHERE EventDate >= 2026-08-02T04:00:00Z AND EventDate <= 2026-08-02T05:00:00Z',
    );
  });

  it('emits no ORDER BY in any query — RTE objects reject it outright', async () => {
    const deps = makeDeps({
      fields: { ListViewEvent: ['EventDate'], GuestUserAnomalyEvent: ['EventDate'], GuestUserAnomalyEventStore: ['EventDate'] },
      rows: {
        ListViewEvent: [{ EventDate: '2026-08-02T04:00:00.000Z' }],
        GuestUserAnomalyEvent: new Error('does not support query'),
        GuestUserAnomalyEventStore: [{ EventDate: '2026-08-02T04:00:00.000Z' }],
      },
    });

    await pullRealtimeEvents(deps, { window: WINDOW, catalog: [LIST_VIEW, GUEST_ANOMALY] });

    expect(emittedSoql.length).toBeGreaterThan(1);
    for (const soql of emittedSoql) expect(soql).not.toMatch(/ORDER BY/i);
  });

  it('sorts rows client-side, since the org will not do it', async () => {
    const deps = makeDeps({
      fields: { ListViewEvent: ['EventDate'] },
      rows: {
        ListViewEvent: [
          { EventDate: '2026-08-02T04:30:00.000Z', n: 2 },
          { EventDate: '2026-08-02T04:10:00.000Z', n: 1 },
        ],
      },
    });

    await pullRealtimeEvents(deps, { window: WINDOW, catalog: [LIST_VIEW] });

    const file = deps.store.realtimePathFor('00Dxx', 'ListViewEvent', '2026-08-02', '04');
    const parsed = fs.readFileSync(file, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    expect(parsed.map((r) => r.n)).toEqual([1, 2]);
  });

  it('buckets rows spanning several hours into one file each', async () => {
    const deps = makeDeps({
      fields: { ListViewEvent: ['EventDate'] },
      rows: {
        ListViewEvent: [
          { EventDate: '2026-08-02T04:10:00.000Z' },
          { EventDate: '2026-08-02T05:10:00.000Z' },
          { EventDate: '2026-08-03T00:10:00.000Z' },
        ],
      },
    });

    const result = await pullRealtimeEvents(deps, {
      window: { from: '2026-08-02T04:00:00Z', to: '2026-08-03T01:00:00Z' },
      catalog: [LIST_VIEW],
    });

    expect(result.captured[0].paths).toHaveLength(3);
    expect(result.captured[0].paths.map((p) => path.basename(p)).sort()).toEqual([
      '00.ndjson',
      '04.ndjson',
      '05.ndjson',
    ]);
  });

  it('skips an object-hour already on disk unless forced', async () => {
    const deps = makeDeps({
      fields: { ListViewEvent: ['EventDate'] },
      rows: { ListViewEvent: [{ EventDate: '2026-08-02T04:10:00.000Z' }] },
    });
    deps.store.saveRealtime('00Dxx', 'ListViewEvent', '2026-08-02', '04', [{ existing: true }]);

    const skipped = await pullRealtimeEvents(deps, { window: WINDOW, catalog: [LIST_VIEW] });
    expect(skipped.captured[0].rows).toBe(0);
    const file = deps.store.realtimePathFor('00Dxx', 'ListViewEvent', '2026-08-02', '04');
    expect(fs.readFileSync(file, 'utf-8')).toContain('existing');

    const forced = await pullRealtimeEvents(deps, { window: WINDOW, catalog: [LIST_VIEW], force: true });
    expect(forced.captured[0].rows).toBe(1);
    expect(fs.readFileSync(file, 'utf-8')).not.toContain('existing');
  });

  it('never lets one failing object stop the rest of the catalog', async () => {
    const deps = makeDeps({
      fields: { ListViewEvent: ['EventDate'] },
      rows: { ListViewEvent: [{ EventDate: '2026-08-02T04:00:00.000Z' }] },
    });

    const result = await pullRealtimeEvents(deps, {
      window: WINDOW,
      catalog: [GUEST_ANOMALY, LIST_VIEW],
    });

    expect(result.unavailable).toHaveLength(1);
    expect(result.captured).toHaveLength(1);
  });

  it('rejects a malformed window before contacting the org', async () => {
    const deps = makeDeps({ fields: {}, rows: {} });
    await expect(
      pullRealtimeEvents(deps, { window: { from: '2026-08-02', to: 'x' }, catalog: [LIST_VIEW] }),
    ).rejects.toThrow(TypeError);
    expect(emittedSoql).toEqual([]);
  });
});

describe('buildRealtimeQuery', () => {
  it('strips anything that is not an identifier from the object and field names', () => {
    const soql = buildRealtimeQuery("ListViewEvent WHERE Id != null--", ["Event'Date"], WINDOW);
    expect(soql).toContain('FROM ListViewEventWHEREIdnull');
    expect(soql).toContain('SELECT EventDate');
    expect(soql).not.toContain('--');
  });
});

describe('classifyRteError', () => {
  it.each([
    ['entity type ApiAnomalyEvent does not support query', 'not-queryable'],
    ['INSUFFICIENT_ACCESS_OR_READONLY', 'no-permission'],
    ["sObject type 'FileEvent' is not supported", 'unlicensed'],
    ['something else entirely', 'unknown'],
  ])('maps %s to %s', (message, expected) => {
    expect(classifyRteError(new Error(message))).toBe(expected);
  });
});

describe('RTE_CATALOG', () => {
  it('declares ListViewEvent with no Store — the split is not derivable from the name', () => {
    expect(RTE_CATALOG.find((e) => e.base === 'ListViewEvent')?.store).toBeUndefined();
    expect(RTE_CATALOG.find((e) => e.base === 'GuestUserAnomalyEvent')?.store).toBe(
      'GuestUserAnomalyEventStore',
    );
  });

  it('asks every object for the fields that answer "did records leave"', () => {
    for (const entry of RTE_CATALOG) {
      expect(entry.preferredFields).toEqual(
        expect.arrayContaining(['RowsProcessed', 'QueriedEntities', 'Records', 'EventDate']),
      );
    }
  });

  it('has no duplicate base names', () => {
    const names = RTE_CATALOG.map((e) => e.base);
    expect(new Set(names).size).toBe(names.length);
  });
});
