import { apiErrorFromResponse } from '../ApiError.js';
import type { AccessToken } from './jwtBearer.js';

export interface FetchTransportOptions {
  /** Obtains an access token. Called lazily, and again after a 401. */
  auth: () => Promise<AccessToken>;
  /** API version without the leading `v`, e.g. '64.0'. Never defaulted in sf-core. */
  apiVersion: string;
  fetch?: typeof fetch;
  /** Time to response headers, per request. Defaults to 120 seconds. The body then streams with no limit. */
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
   * A timeout surfaces as a TimeoutError DOMException (as AbortSignal.timeout raises), deliberately not converted
   * to an ApiError: it is not a Salesforce error response and carries no errorCode.
   */
  async get(path: string, accept = 'application/json'): Promise<Response> {
    const used = this.currentToken();
    const res = await this.send(await used, path, accept);
    if (res.ok) return res;
    if (res.status === 401) {
      // Release the 401's socket before the retry; its body says nothing the retry won't.
      await res.body?.cancel().catch(() => undefined);
      // Each call gets at most one re-auth, and concurrent 401s on the same token share one exchange.
      const retry = await this.send(await this.refreshedToken(used), path, accept);
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

  /** The cached token, fetched lazily on first use and shared by concurrent first calls. */
  private currentToken(): Promise<AccessToken> {
    this.token ??= this.startAuth();
    return this.token;
  }

  /**
   * A token to retry with after `used` drew a 401. Only the first caller holding `used` starts a new
   * exchange; any later one finds the cache already moved on and reuses that.
   */
  private refreshedToken(used: Promise<AccessToken>): Promise<AccessToken> {
    if (this.token === used || this.token === undefined) this.token = this.startAuth();
    return this.token;
  }

  private startAuth(): Promise<AccessToken> {
    const fresh = this.authFn();
    // A failed auth must not be cached, or every later call would fail with the same rejection.
    fresh.catch(() => {
      if (this.token === fresh) this.token = undefined;
    });
    return fresh;
  }

  private send(token: AccessToken, path: string, accept: string): Promise<Response> {
    const rel = path.startsWith('/services/')
      ? path
      : `/services/data/v${this.apiVersion}${path.startsWith('/') ? '' : '/'}${path}`;
    // The timer covers time to response headers only and is cleared once they arrive (or the call
    // fails), so a large body, such as an EventLogFile, streams with no time limit.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), this.timeoutMs);
    return this.fetch(`${token.instanceUrl}${rel}`, {
      headers: { Authorization: `Bearer ${token.accessToken}`, Accept: accept },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  }
}
