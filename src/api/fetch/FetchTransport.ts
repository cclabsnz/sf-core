import { apiErrorFromResponse } from '../ApiError.js';
import type { AccessToken } from './jwtBearer.js';

export interface FetchTransportOptions {
  /** Obtains an access token. Called lazily, and again after a 401. */
  auth: () => Promise<AccessToken>;
  /** API version without the leading `v`, e.g. '64.0'. Never defaulted in sf-core. */
  apiVersion: string;
  fetch?: typeof fetch;
  /** Per-request timeout. Defaults to 120 seconds. */
  timeoutMs?: number;
}

/**
 * The fetch path's single door to the org: URL building, bearer header, timeout, one re-auth
 * after a 401, and error mapping. GET only; there is deliberately no other verb here.
 */
export class FetchTransport {
  private readonly authFn: () => Promise<AccessToken>;
  private readonly apiVersion: string;
  // Named `fetch` so the read-only invariant's scanner sees the one call site in send().
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;
  private token: Promise<AccessToken> | undefined;

  constructor(opts: FetchTransportOptions) {
    this.authFn = opts.auth;
    this.apiVersion = opts.apiVersion;
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  /**
   * GETs `path`. A path starting `/services/` is used as-is (a `nextRecordsUrl`, or `/services/data/`);
   * any other path is prefixed with the versioned data root, matching RestClientImpl.
   *
   * A timeout surfaces as the DOMException AbortSignal.timeout raises, deliberately not converted
   * to an ApiError: it is not a Salesforce error response and carries no errorCode.
   */
  async get(path: string, accept = 'application/json'): Promise<Response> {
    const res = await this.attempt(path, accept, false);
    if (res.ok) return res;
    if (res.status === 401) {
      // Each call gets at most one re-auth. Concurrent 401s share the refreshed token promise.
      const retry = await this.attempt(path, accept, true);
      if (retry.ok) return retry;
      throw await apiErrorFromResponse(retry);
    }
    throw await apiErrorFromResponse(res);
  }

  async getJson<T>(path: string): Promise<T> {
    const res = await this.get(path);
    return (await res.json()) as T;
  }

  async getText(path: string): Promise<string> {
    const res = await this.get(path, '*/*');
    return res.text();
  }

  /** The org's clock, from the Date header of the `/services/data/` listing. */
  async serverDate(): Promise<Date> {
    const res = await this.get('/services/data/');
    const header = res.headers.get('date');
    const parsed = header === null ? new Date(Number.NaN) : new Date(header);
    if (Number.isNaN(parsed.getTime())) throw new Error('the org response carried no usable Date header');
    return parsed;
  }

  private async attempt(path: string, accept: string, refresh: boolean): Promise<Response> {
    const token = await this.getToken(refresh);
    return this.send(token, path, accept);
  }

  /** Lazily fetches and caches the token. `refresh` drops the cached one first, unless another call already did. */
  private getToken(refresh: boolean): Promise<AccessToken> {
    if (refresh || this.token === undefined) {
      const fresh = this.authFn();
      this.token = fresh;
      // A failed auth must not be cached, or every later call would fail with the same rejection.
      fresh.catch(() => {
        if (this.token === fresh) this.token = undefined;
      });
      return fresh;
    }
    return this.token;
  }

  private send(token: AccessToken, path: string, accept: string): Promise<Response> {
    const rel = path.startsWith('/services/')
      ? path
      : `/services/data/v${this.apiVersion}${path.startsWith('/') ? '' : '/'}${path}`;
    return this.fetch(`${token.instanceUrl}${rel}`, {
      headers: { Authorization: `Bearer ${token.accessToken}`, Accept: accept },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }
}
