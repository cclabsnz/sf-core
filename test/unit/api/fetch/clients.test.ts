import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isApiError } from '../../../../src/api/ApiError.js';
import { SoqlClientImpl } from '../../../../src/api/SoqlClientImpl.js';
import { ToolingClientImpl } from '../../../../src/api/ToolingClientImpl.js';
import { RestClientImpl } from '../../../../src/api/RestClientImpl.js';
import { FetchTransport } from '../../../../src/api/fetch/FetchTransport.js';
import { FetchSoqlClient } from '../../../../src/api/fetch/FetchSoqlClient.js';
import { FetchToolingClient } from '../../../../src/api/fetch/FetchToolingClient.js';
import { FetchRestClient } from '../../../../src/api/fetch/FetchRestClient.js';
import { createFetchClients } from '../../../../src/api/fetch/index.js';
import { streamToFile } from '../../../../src/api/streamToFile.js';

const INSTANCE = 'https://x.my.salesforce.com';
const ROOT = '/services/data/v64.0';
const SOQL = 'SELECT Id FROM Account';
const TOOLING_SOQL = 'SELECT Id FROM ApexClass';

interface Route {
  status: number;
  body: string;
  json: boolean;
}
const json = (v: unknown, status = 200): Route => ({ status, body: JSON.stringify(v), json: true });
const q = (s: string) => `?q=${encodeURIComponent(s)}`;

// One table of recorded org responses, served to both transports.
const ROUTES: Record<string, Route> = {
  [`${ROOT}/query${q(SOQL)}`]: json({
    totalSize: 5, done: false, records: [{ Id: '1' }, { Id: '2' }],
    nextRecordsUrl: `${ROOT}/query/01g-2000`,
  }),
  [`${ROOT}/query/01g-2000`]: json({
    totalSize: 5, done: false, records: [{ Id: '3' }, { Id: '4' }],
    nextRecordsUrl: `${ROOT}/query/01g-4000`,
  }),
  [`${ROOT}/query/01g-4000`]: json({ totalSize: 5, done: true, records: [{ Id: '5' }] }),
  [`${ROOT}/tooling/query${q(TOOLING_SOQL)}`]: json({
    totalSize: 3, done: false, records: [{ Id: 'a' }, { Id: 'b' }],
    nextRecordsUrl: `${ROOT}/tooling/query/01g-2000`,
  }),
  [`${ROOT}/tooling/query/01g-2000`]: json({ totalSize: 3, done: true, records: [{ Id: 'c' }] }),
  [`${ROOT}/tooling/sobjects/ConnectedApplication/0H4xx/`]: json({ Id: '0H4xx', Name: 'App' }),
  [`${ROOT}/limits/`]: json({ DailyApiRequests: { Max: 15000, Remaining: 14000 } }),
  [`${ROOT}/sobjects/EventLogFile/0ATok/LogFile`]: {
    status: 200, body: 'EVENT_TYPE,TIMESTAMP\nLogin,20260707T101500.000Z\n', json: false,
  },
  [`${ROOT}/sobjects/EventLogFile/0ATbad/LogFile`]: json(
    [{ errorCode: 'NOT_FOUND', message: 'The requested resource does not exist' }], 404),
  [`${ROOT}/query${q('SELECT Nope FROM Account')}`]: json(
    [{ errorCode: 'INVALID_FIELD', message: "No such column 'Nope'" }], 400),
};

// A jsforce-shaped failure: errorCode and data, no statusCode.
function jsforceError(route: Route): Error {
  const first = (JSON.parse(route.body) as { errorCode: string; message: string }[])[0];
  return Object.assign(new Error(first.message), { name: first.errorCode, errorCode: first.errorCode, data: first });
}

function serve(p: string): Route {
  return ROUTES[p] ?? json([{ errorCode: 'NOT_FOUND', message: `no route ${p}` }], 404);
}

function fakeConn() {
  const request = async (url: string) => {
    const r = serve(url);
    if (r.status >= 400) throw jsforceError(r);
    return r.json ? JSON.parse(r.body) : r.body;
  };
  return {
    request,
    query: (s: string) => request(`${ROOT}/query${q(s)}`),
    tooling: { query: (s: string) => request(`${ROOT}/tooling/query${q(s)}`) },
    getApiVersion: () => '64.0',
    instanceUrl: INSTANCE,
    accessToken: 'tok',
  };
}

function fakeFetch(seen: string[] = []): typeof fetch {
  return (async (url: string) => {
    seen.push(url);
    const r = serve(url.slice(INSTANCE.length));
    return new Response(r.body, { status: r.status });
  }) as unknown as typeof fetch;
}

function transportFor(f: typeof fetch) {
  return new FetchTransport({
    auth: async () => ({ accessToken: 'tok', instanceUrl: INSTANCE }),
    apiVersion: '64.0',
    fetch: f,
  });
}

describe('fetch clients agree with the Connection clients', () => {
  let tmp: string;
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-clients-'));
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const conn = () => fakeConn() as any;
  const fetchSide = () => {
    const t = transportFor(fakeFetch());
    return { soql: new FetchSoqlClient(t), tooling: new FetchToolingClient(t), rest: new FetchRestClient(t) };
  };

  it('SoqlClient.query returns the same first page', async () => {
    const a = await new SoqlClientImpl(conn()).query(SOQL);
    const b = await fetchSide().soql.query(SOQL);
    expect(b).toEqual(a);
    expect(b).toEqual({ totalSize: 5, done: false, records: [{ Id: '1' }, { Id: '2' }] });
  });

  it('SoqlClient.queryAll returns all three pages identically', async () => {
    const a = await new SoqlClientImpl(conn()).queryAll(SOQL);
    const b = await fetchSide().soql.queryAll(SOQL);
    expect(b).toEqual(a);
    expect(b).toHaveLength(5);
  });

  it('ToolingClient.query and getRecord match', async () => {
    const impl = new ToolingClientImpl(conn());
    const f = fetchSide().tooling;
    expect(await f.query(TOOLING_SOQL)).toEqual(await impl.query(TOOLING_SOQL));
    expect(await f.query(TOOLING_SOQL)).toHaveLength(3);
    expect(await f.getRecord('ConnectedApplication', '0H4xx')).toEqual(
      await impl.getRecord('ConnectedApplication', '0H4xx'));
  });

  it('RestClient.get and getRaw match', async () => {
    const impl = new RestClientImpl(conn());
    const f = fetchSide().rest;
    expect(await f.get('/limits/')).toEqual(await impl.get('/limits/'));
    const logPath = '/sobjects/EventLogFile/0ATok/LogFile';
    expect(await f.getRaw(logPath)).toEqual(await impl.getRaw(logPath));
  });

  it('RestClient.getRawToFile writes the same bytes and contents', async () => {
    const logPath = '/sobjects/EventLogFile/0ATok/LogFile';
    globalThis.fetch = fakeFetch();
    const implDest = path.join(tmp, 'impl', 'out.csv');
    const fetchDest = path.join(tmp, 'fetch', 'out.csv');
    const a = await new RestClientImpl(conn()).getRawToFile(logPath, implDest);
    const b = await fetchSide().rest.getRawToFile(logPath, fetchDest);
    expect(b).toBe(a);
    expect(fs.readFileSync(fetchDest, 'utf-8')).toBe(fs.readFileSync(implDest, 'utf-8'));
  });

  it('a 400 INVALID_FIELD gives the same errorCode on both sides', async () => {
    const bad = 'SELECT Nope FROM Account';
    const a = await new SoqlClientImpl(conn()).query(bad).catch((e: unknown) => e);
    const b = await fetchSide().soql.query(bad).catch((e: unknown) => e);
    expect(isApiError(a)).toBe(true);
    expect(isApiError(b)).toBe(true);
    expect((b as any).errorCode).toBe('INVALID_FIELD');
    expect((b as any).errorCode).toBe((a as any).errorCode);
  });

  it('a non-OK LogFile download gives the same errorCode and leaves no file on both sides', async () => {
    const logPath = '/sobjects/EventLogFile/0ATbad/LogFile';
    globalThis.fetch = fakeFetch();
    const implDest = path.join(tmp, 'impl.csv');
    const fetchDest = path.join(tmp, 'fetch.csv');
    const a = await new RestClientImpl(conn()).getRawToFile(logPath, implDest).catch((e: unknown) => e);
    const b = await fetchSide().rest.getRawToFile(logPath, fetchDest).catch((e: unknown) => e);
    expect(isApiError(a)).toBe(true);
    expect(isApiError(b)).toBe(true);
    expect((a as any).errorCode).toBe('NOT_FOUND');
    expect((b as any).errorCode).toBe((a as any).errorCode);
    expect(fs.existsSync(implDest)).toBe(false);
    expect(fs.existsSync(fetchDest)).toBe(false);
  });
});

describe('FetchSoqlClient', () => {
  it('encodes the SOQL in the request URL', async () => {
    const seen: string[] = [];
    const t = transportFor(fakeFetch(seen));
    await new FetchSoqlClient(t).query("SELECT Id FROM Account WHERE Name = 'a&b'").catch(() => undefined);
    expect(seen[0]).toContain("q=SELECT%20Id%20FROM%20Account%20WHERE%20Name%20%3D%20'a%26b'");
  });
});

describe('FetchRestClient.getRawToFile', () => {
  it('throws EMPTY_BODY when the response has no body', async () => {
    const f = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const err = await new FetchRestClient(transportFor(f))
      .getRawToFile('/x/LogFile', path.join(os.tmpdir(), 'never-written.csv'))
      .catch((e: unknown) => e);
    expect(isApiError(err)).toBe(true);
    expect((err as any).errorCode).toBe('EMPTY_BODY');
  });
});

describe('streamToFile', () => {
  it('leaves no file behind when the stream errors mid-way', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-to-file-'));
    try {
      const dest = path.join(tmp, 'sub', 'out.csv');
      let sent = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(new TextEncoder().encode('partial,'));
          } else {
            controller.error(new Error('connection reset'));
          }
        },
      });
      await expect(streamToFile(body, dest)).rejects.toThrow('connection reset');
      expect(fs.existsSync(dest)).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('createFetchClients', () => {
  it('uses a function auth directly and wires all clients to one transport', async () => {
    let authCalls = 0;
    const c = createFetchClients({
      auth: async () => {
        authCalls++;
        return { accessToken: 'tok', instanceUrl: INSTANCE };
      },
      apiVersion: '64.0',
      fetch: fakeFetch(),
    });
    expect(await c.soql.queryAll(SOQL)).toHaveLength(5);
    expect(await c.tooling.query(TOOLING_SOQL)).toHaveLength(3);
    expect(await c.rest.get('/limits/')).toBeDefined();
    expect(c.transport).toBeInstanceOf(FetchTransport);
    expect(authCalls).toBe(1);
  });
});
