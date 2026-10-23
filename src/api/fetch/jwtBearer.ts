import { createSign } from 'node:crypto';
import { SalesforceApiError } from '../ApiError.js';

/** The global fetch signature, named once so the call site below can shadow `fetch` locally. */
type FetchFn = typeof fetch;

/** Signs the JWT signing input with RS256 and returns the raw signature bytes. */
export type Signer = (signingInput: string) => Promise<Buffer>;

/**
 * A signer over a PEM held in this process.
 *
 * Vercel, GitHub Actions and Lambda environment variables all round-trip PEM newlines as the
 * literal two characters `\n`; a key with escaped newlines fails at signing time, far from the
 * cause, so they are restored here.
 */
export function pemSigner(privateKeyPem: string): Signer {
  const pem = privateKeyPem.replace(/\\n/g, '\n');
  if (pem.trim() === '') {
    throw new Error(
      "The JWT signing key is empty. It is the private half of the certificate uploaded to the org's " +
        'External Client App; without it the org cannot be reached.',
    );
  }
  // Synchronous under the hood, and deliberately still a promise: other signers (a KMS) are network calls.
  return (signingInput) => Promise.resolve(createSign('RSA-SHA256').update(signingInput).sign(pem));
}

export interface JwtBearerConfig {
  /** External Client App consumer key. Becomes the JWT `iss`. */
  clientId: string;
  /** The Salesforce username to run as. Becomes the JWT `sub`. */
  username: string;
  /** Token endpoint host: login.salesforce.com, test.salesforce.com or a My Domain URL. */
  loginUrl: string;
  /** The `aud` claim. Defaults to `loginUrl`. */
  audience?: string;
  sign: Signer;
}

export interface AccessToken {
  accessToken: string;
  instanceUrl: string;
}

interface TokenResponse {
  access_token?: string;
  instance_url?: string;
  // Untrusted: a misbehaving endpoint can send any JSON here, so read them through `str`.
  error?: unknown;
  error_description?: unknown;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** base64url without padding, as JWS requires. */
const b64url = (input: Buffer | string): string =>
  (typeof input === 'string' ? Buffer.from(input, 'utf8') : input)
    .toString('base64url');

const truncate = (s: string, max = 300): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * Exchange a signed assertion for an access token (OAuth 2.0 JWT bearer flow).
 *
 * This is the only request in sf-core that is not a GET. It authenticates and writes no org data.
 * The `exp` claim must be within five minutes of now or Salesforce rejects it; three minutes leaves
 * room for clock skew without approaching that ceiling. There is no `iat` or `jti`: Salesforce
 * ignores both. Salesforce returns no `expires_in` for this flow, so callers treat a 401 as expiry.
 *
 * Neither the private key nor the access token ever appears in a thrown error.
 */
export async function jwtBearerToken(
  config: JwtBearerConfig,
  deps: { fetch?: FetchFn; now?: () => number } = {},
): Promise<AccessToken> {
  // The assertion is a three-minute bearer credential; never let it travel over cleartext.
  let loginProtocol: string | undefined;
  try {
    loginProtocol = new URL(config.loginUrl).protocol;
  } catch {
    loginProtocol = undefined;
  }
  if (loginProtocol !== 'https:') {
    throw new SalesforceApiError('INVALID_LOGIN_URL', 'The login URL must be a valid https URL; nothing was signed or sent.');
  }

  const now = deps.now ?? Date.now;
  const header = b64url(JSON.stringify({ alg: 'RS256' }));
  const claims = b64url(
    JSON.stringify({
      iss: config.clientId,
      sub: config.username,
      aud: config.audience ?? config.loginUrl,
      exp: Math.floor(now() / 1000) + 180,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const assertion = `${signingInput}.${b64url(await config.sign(signingInput))}`;
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }).toString();

  const fetch = deps.fetch ?? globalThis.fetch;
  const res = await fetch(`${config.loginUrl.replace(/\/$/, '')}/services/oauth2/token`, { // invariant:allow — OAuth token exchange; authenticates, writes no org data
    method: 'POST', // invariant:allow — OAuth token exchange; authenticates, writes no org data
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });

  const text = await res.text();
  let parsed: TokenResponse;
  try {
    parsed = JSON.parse(text) as TokenResponse;
  } catch {
    throw new SalesforceApiError('TOKEN_ENDPOINT_NOT_JSON', truncate(text), { statusCode: res.status });
  }
  if (typeof parsed !== 'object' || parsed === null) parsed = {};

  if (!res.ok || typeof parsed.access_token !== 'string' || parsed.access_token === '') {
    // Never carry a token into details, even on a failed response.
    const { access_token: _dropped, ...safe } = parsed;
    throw new SalesforceApiError(str(parsed.error) ?? 'TOKEN_REQUEST_FAILED', explainTokenError(parsed), {
      statusCode: res.status,
      details: safe,
    });
  }

  const instanceUrl = (parsed.instance_url ?? '').replace(/\/$/, '');
  let protocol: string | undefined;
  try {
    protocol = new URL(instanceUrl).protocol;
  } catch {
    protocol = undefined;
  }
  if (protocol !== 'https:') {
    throw new SalesforceApiError(
      'INVALID_INSTANCE_URL',
      'The token endpoint returned an instance_url that is missing or not https; refusing to send the access token there.',
      { statusCode: res.status },
    );
  }
  return { accessToken: parsed.access_token, instanceUrl };
}

/**
 * The JWT bearer flow's failures are opaque: `invalid_grant` covers at least four unrelated
 * misconfigurations. The two that actually happen are named here.
 */
function explainTokenError(parsed: TokenResponse): string {
  const base = str(parsed.error_description) ?? str(parsed.error) ?? 'The token request failed.';
  if (parsed.error === 'invalid_grant') {
    return (
      `${base} (for the JWT bearer flow this usually means one of: the user is not pre-authorised ` +
      'for the External Client App (assign the permission set, or set the app policy to admin-approved ' +
      'users); the certificate in the External Client App does not match the signing private key; the ' +
      'username is wrong for this org; or the app was saved less than ten minutes ago and has not ' +
      'propagated yet.)'
    );
  }
  if (parsed.error === 'invalid_client_id') {
    return `${base} (the consumer key does not match an External Client App in this org.)`;
  }
  return base;
}
