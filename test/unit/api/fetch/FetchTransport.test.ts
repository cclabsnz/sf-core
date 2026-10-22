import { isApiError } from '../../../../src/api/ApiError.js';
import { FetchTransport } from '../../../../src/api/fetch/FetchTransport.js';

const INSTANCE = 'https://x.my.salesforce.com';

interface Reply {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

function setup(replies: Reply[]) {
  const calls: { url: string; init: any }[] = [];
  let i = 0;
  const fn = (async (url: string, init: any) => {
    calls.push({ url, init });
    const r = replies[Math.min(i++, replies.length - 1)];
    return new Response(r.body ?? '{}', {
      status: r.status,
      headers: { 'content-type': 'application/json;charset=UTF-8', ...r.headers },
    });
  }) as unknown as typeof fetch;
  let authCalls = 0;
  const auth = async () => {
    authCalls++;
    return { accessToken: authCalls === 1 ? 'tok' : 'tok2', instanceUrl: INSTANCE };
  };
  const transport = new FetchTransport({ auth, apiVersion: '64.0', fetch: fn });
  return { transport, calls, authCount: () => authCalls };
}

const INVALID_SESSION = JSON.stringify([{ errorCode: 'INVALID_SESSION_ID', message: 'expired' }]);

describe('FetchTransport', () => {
  it('prefixes a relative path with the versioned data root', async () => {
    const { transport, calls } = setup([{ status: 200 }]);
    await transport.get('limits/');
    expect(calls[0].url).toBe(`${INSTANCE}/services/data/v64.0/limits/`);
  });

  it('adds a leading slash when the path lacks one', async () => {
    const { transport, calls } = setup([{ status: 200 }]);
    await transport.get('/limits/');
    expect(calls[0].url).toBe(`${INSTANCE}/services/data/v64.0/limits/`);
  });

  it('uses a /services/ path as-is, with no double prefix', async () => {
    const { transport, calls } = setup([{ status: 200 }]);
    await transport.get('/services/data/v64.0/query/01gXX-2000');
    expect(calls[0].url).toBe(`${INSTANCE}/services/data/v64.0/query/01gXX-2000`);
  });

  it('sends a bearer token and a GET with no method override', async () => {
    const { transport, calls } = setup([{ status: 200 }]);
    await transport.get('limits/');
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok');
    expect(calls[0].init.headers.Accept).toBe('application/json');
    expect(calls[0].init.method).toBeUndefined();
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('shares one auth() across concurrent first calls', async () => {
    const { transport, authCount } = setup([{ status: 200 }]);
    await Promise.all([transport.get('a'), transport.get('b')]);
    expect(authCount()).toBe(1);
  });

  it('re-authenticates once after a 401 and resolves on the retry', async () => {
    const { transport, calls, authCount } = setup([{ status: 401, body: INVALID_SESSION }, { status: 200 }]);
    const res = await transport.get('limits/');
    expect(res.status).toBe(200);
    expect(authCount()).toBe(2);
    expect(calls[1].init.headers.Authorization).toBe('Bearer tok2');
  });

  it('throws after a second 401, with auth() called exactly twice', async () => {
    const { transport, authCount, calls } = setup([{ status: 401, body: INVALID_SESSION }]);
    const err = await transport.get('limits/').catch((e) => e);
    expect(isApiError(err)).toBe(true);
    expect(err.errorCode).toBe('INVALID_SESSION_ID');
    expect(err.statusCode).toBe(401);
    expect(authCount()).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it('shares one refreshed token across concurrent 401s', async () => {
    let authCalls = 0;
    const auth = async () => {
      authCalls++;
      return { accessToken: `tok${authCalls}`, instanceUrl: INSTANCE };
    };
    // The first token is expired; every later one is good.
    const fn = (async (_url: string, init: any) =>
      init.headers.Authorization === 'Bearer tok1'
        ? new Response(INVALID_SESSION, { status: 401, headers: { 'content-type': 'application/json' } })
        : new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const transport = new FetchTransport({ auth, apiVersion: '64.0', fetch: fn });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => transport.get(`limits/${i}`)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(authCalls).toBe(2);
  });

  it('releases the 401 response body before retrying', async () => {
    let cancelled = false;
    let n = 0;
    const fn = (async () => {
      n++;
      if (n > 1) return new Response('{}', { status: 200 });
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode(INVALID_SESSION));
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, { status: 401 });
    }) as unknown as typeof fetch;
    let a = 0;
    const transport = new FetchTransport({
      auth: async () => ({ accessToken: `tok${++a}`, instanceUrl: INSTANCE }),
      apiVersion: '64.0',
      fetch: fn,
    });
    expect((await transport.get('limits/')).status).toBe(200);
    expect(cancelled).toBe(true);
  });

  it('does not retry other statuses', async () => {
    const body = JSON.stringify([{ errorCode: 'QUERY_TIMEOUT', message: 'slow' }]);
    const { transport, calls, authCount } = setup([{ status: 400, body }]);
    const err = await transport.get('query/?q=x').catch((e) => e);
    expect(err.errorCode).toBe('QUERY_TIMEOUT');
    expect(calls).toHaveLength(1);
    expect(authCount()).toBe(1);
  });

  it('getJson parses the body and getText asks for */*', async () => {
    const { transport, calls } = setup([{ status: 200, body: '{"a":1}' }, { status: 200, body: 'raw,csv' }]);
    expect(await transport.getJson<{ a: number }>('x')).toEqual({ a: 1 });
    expect(await transport.getText('y')).toBe('raw,csv');
    expect(calls[1].init.headers.Accept).toBe('*/*');
  });

  it('serverDate reads the Date header from /services/data/', async () => {
    const { transport, calls } = setup([{ status: 200, headers: { Date: 'Wed, 21 Oct 2026 07:28:00 GMT' } }]);
    const d = await transport.serverDate();
    expect(d.toISOString()).toBe('2026-10-21T07:28:00.000Z');
    expect(calls[0].url).toBe(`${INSTANCE}/services/data/`);
  });

  it('serverDate rejects when the Date header is missing or invalid', async () => {
    const msg = 'the org response carried no usable Date header';
    const missing = setup([{ status: 200 }]);
    // Node's Response adds no Date header, so this is genuinely absent.
    await expect(missing.transport.serverDate()).rejects.toThrow(msg);
    const bad = setup([{ status: 200, headers: { Date: 'not a date' } }]);
    await expect(bad.transport.serverDate()).rejects.toThrow(msg);
  });
});

describe('FetchTransport timeout', () => {
  const auth = async () => ({ accessToken: 'tok', instanceUrl: INSTANCE });

  it('rejects when no response headers arrive within timeoutMs', async () => {
    const hang = ((_url: string, init: any) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      })) as unknown as typeof fetch;
    const transport = new FetchTransport({ auth, apiVersion: '64.0', fetch: hang, timeoutMs: 20 });
    await expect(transport.get('limits/')).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('does not abort a body that streams longer than timeoutMs', async () => {
    const slow = (async (_url: string, init: any) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => {
            if (init.signal.aborted) {
              controller.error(init.signal.reason);
              return;
            }
            controller.enqueue(new TextEncoder().encode('late,data\n'));
            controller.close();
          }, 80);
        },
      });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const transport = new FetchTransport({ auth, apiVersion: '64.0', fetch: slow, timeoutMs: 20 });
    expect(await transport.getText('/sobjects/EventLogFile/ID/LogFile')).toBe('late,data\n');
  });
});
