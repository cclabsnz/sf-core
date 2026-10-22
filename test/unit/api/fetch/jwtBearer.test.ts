import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { isApiError } from '../../../../src/api/ApiError.js';
import { jwtBearerToken, pemSigner } from '../../../../src/api/fetch/jwtBearer.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const NOW = 1_700_000_000_000;
const TOKEN = 'TOKEN_MARKER_00D000000000001';
// A distinctive slice of the key body; it must never show up in an error.
const KEY_MARKER = pem.split('\n')[1];

const config = (loginUrl = 'https://login.salesforce.com') => ({
  clientId: 'consumerKey',
  username: 'user@example.com',
  loginUrl,
  sign: pemSigner(pem),
});

function fakeFetch(status: number, body: string) {
  const calls: { url: string; init: any }[] = [];
  const fn = (async (url: string, init: any) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => body } as any;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const dec = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

describe('jwtBearerToken', () => {
  it('posts a signed RS256 assertion to the token endpoint and returns the token', async () => {
    const { fn, calls } = fakeFetch(
      200,
      JSON.stringify({ access_token: TOKEN, instance_url: 'https://acme.my.salesforce.com/' }),
    );
    const out = await jwtBearerToken(config(), { fetch: fn, now: () => NOW });
    expect(out).toEqual({ accessToken: TOKEN, instanceUrl: 'https://acme.my.salesforce.com' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://login.salesforce.com/services/oauth2/token');
    expect(calls[0].init.method).toBe('POST');
    const form = new URLSearchParams(calls[0].init.body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');

    const [h, c, s] = form.get('assertion')!.split('.');
    expect(JSON.parse(dec(h))).toEqual({ alg: 'RS256' });
    expect(JSON.parse(dec(c))).toEqual({
      iss: 'consumerKey',
      sub: 'user@example.com',
      aud: 'https://login.salesforce.com',
      exp: NOW / 1000 + 180,
    });
    expect(h + c + s).not.toMatch(/[+/=]/);
    const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(pubPem, Buffer.from(s, 'base64url'));
    expect(ok).toBe(true);
  });

  it('uses the audience override when given', async () => {
    const { fn, calls } = fakeFetch(200, JSON.stringify({ access_token: TOKEN, instance_url: 'https://a.b' }));
    await jwtBearerToken(
      { ...config('https://acme.my.salesforce.com'), audience: 'https://login.salesforce.com' },
      { fetch: fn, now: () => NOW },
    );
    const claims = JSON.parse(dec(new URLSearchParams(calls[0].init.body).get('assertion')!.split('.')[1]));
    expect(claims.aud).toBe('https://login.salesforce.com');
    expect(calls[0].url).toBe('https://acme.my.salesforce.com/services/oauth2/token');
  });

  it('explains invalid_grant and keeps the status and code', async () => {
    const body = { error: 'invalid_grant', error_description: "user hasn't approved this consumer" };
    const { fn } = fakeFetch(400, JSON.stringify(body));
    const err = await jwtBearerToken(config(), { fetch: fn, now: () => NOW }).catch((e) => e);
    expect(isApiError(err)).toBe(true);
    expect(err.errorCode).toBe('invalid_grant');
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain('pre-authorised');
    expect(err.message).toContain('External Client App');
    expect(err.message).not.toContain('Connected App');
    expect(err.message).not.toContain(KEY_MARKER);
  });

  it('explains invalid_client_id', async () => {
    const { fn } = fakeFetch(400, JSON.stringify({ error: 'invalid_client_id', error_description: 'bad' }));
    const err = await jwtBearerToken(config(), { fetch: fn, now: () => NOW }).catch((e) => e);
    expect(err.errorCode).toBe('invalid_client_id');
    expect(err.message).toContain('External Client App');
  });

  it('falls back to TOKEN_REQUEST_FAILED when the body has no error code', async () => {
    const { fn } = fakeFetch(500, '{}');
    const err = await jwtBearerToken(config(), { fetch: fn, now: () => NOW }).catch((e) => e);
    expect(err.errorCode).toBe('TOKEN_REQUEST_FAILED');
    expect(err.statusCode).toBe(500);
  });

  it('strips access_token from error details', async () => {
    const { fn } = fakeFetch(200, JSON.stringify({ error: 'weird', access_token: undefined, extra: 'kept' }));
    const err = await jwtBearerToken(config(), { fetch: fn, now: () => NOW }).catch((e) => e);
    expect(err.details).toEqual({ error: 'weird', extra: 'kept' });
    // A failed status that still carries a token must not leak it through details.
    const leaky = fakeFetch(401, JSON.stringify({ error: 'x', access_token: TOKEN }));
    const err2 = await jwtBearerToken(config(), { fetch: leaky.fn, now: () => NOW }).catch((e) => e);
    expect(JSON.stringify(err2.details)).not.toContain(TOKEN);
    expect(err2.message).not.toContain(TOKEN);
  });

  it('reports a non-JSON response as TOKEN_ENDPOINT_NOT_JSON', async () => {
    const { fn } = fakeFetch(502, '<html>bad gateway</html>');
    const err = await jwtBearerToken(config(), { fetch: fn, now: () => NOW }).catch((e) => e);
    expect(err.errorCode).toBe('TOKEN_ENDPOINT_NOT_JSON');
    expect(err.statusCode).toBe(502);
  });

  it('rejects a non-https instance_url without echoing the token', async () => {
    const { fn } = fakeFetch(200, JSON.stringify({ access_token: TOKEN, instance_url: 'http://x' }));
    const err = await jwtBearerToken(config(), { fetch: fn, now: () => NOW }).catch((e) => e);
    expect(err.errorCode).toBe('INVALID_INSTANCE_URL');
    expect(err.message).not.toContain(TOKEN);
    expect(JSON.stringify(err.details ?? '')).not.toContain(TOKEN);
  });

  it('rejects a missing or malformed instance_url', async () => {
    for (const body of [{ access_token: TOKEN }, { access_token: TOKEN, instance_url: 'not a url' }]) {
      const { fn } = fakeFetch(200, JSON.stringify(body));
      const err = await jwtBearerToken(config(), { fetch: fn, now: () => NOW }).catch((e) => e);
      expect(err.errorCode).toBe('INVALID_INSTANCE_URL');
      expect(err.message).not.toContain(TOKEN);
    }
  });
});

describe('pemSigner', () => {
  it('signs identically whether the PEM has real or escaped newlines', async () => {
    const escaped = pem.replace(/\n/g, '\\n');
    const a = await pemSigner(pem)('input');
    const b = await pemSigner(escaped)('input');
    expect(b.equals(a)).toBe(true);
    expect(b.equals(createSign('RSA-SHA256').update('input').sign(pem))).toBe(true);
  });

  it('rejects an empty key with guidance and no key material', () => {
    expect(() => pemSigner('  ')).toThrow(/External Client App/);
    try {
      pemSigner('  ');
    } catch (e) {
      expect((e as Error).message).not.toContain(KEY_MARKER);
    }
  });
});
