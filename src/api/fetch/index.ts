import { FetchRestClient } from './FetchRestClient.js';
import { FetchSoqlClient } from './FetchSoqlClient.js';
import { FetchToolingClient } from './FetchToolingClient.js';
import { FetchTransport } from './FetchTransport.js';
import { jwtBearerToken, type AccessToken, type JwtBearerConfig } from './jwtBearer.js';

export { FetchSoqlClient } from './FetchSoqlClient.js';
export { FetchToolingClient } from './FetchToolingClient.js';
export { FetchRestClient } from './FetchRestClient.js';
export { FetchTransport } from './FetchTransport.js';
export type { FetchTransportOptions } from './FetchTransport.js';
export { jwtBearerToken, pemSigner } from './jwtBearer.js';
export type { AccessToken, JwtBearerConfig, Signer } from './jwtBearer.js';
export type { PagingOptions } from '../paging.js';

export interface CreateFetchClientsOptions {
  /** A JWT bearer config, or your own token source. */
  auth: JwtBearerConfig | (() => Promise<AccessToken>);
  /** API version without the leading `v`, e.g. '64.0'. */
  apiVersion: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Page cap for queryAll and Tooling query, child relationship pages included. Defaults to 200. */
  maxPages?: number;
}

/** Builds the three clients over one shared transport, so they share one token. */
export function createFetchClients(opts: CreateFetchClientsOptions): {
  soql: FetchSoqlClient;
  tooling: FetchToolingClient;
  rest: FetchRestClient;
  transport: FetchTransport;
} {
  const auth =
    typeof opts.auth === 'function'
      ? opts.auth
      : (() => {
          const config = opts.auth;
          return () => jwtBearerToken(config, { fetch: opts.fetch });
        })();
  const transport = new FetchTransport({
    auth,
    apiVersion: opts.apiVersion,
    fetch: opts.fetch,
    timeoutMs: opts.timeoutMs,
  });
  return {
    soql: new FetchSoqlClient(transport, { maxPages: opts.maxPages }),
    tooling: new FetchToolingClient(transport, { maxPages: opts.maxPages }),
    rest: new FetchRestClient(transport),
    transport,
  };
}
