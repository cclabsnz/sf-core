import { collectPages, type QueryPage } from '../paging.js';
import type { QueryResult, SoqlClient } from '../SoqlClient.js';
import type { FetchTransport } from './FetchTransport.js';

/** SoqlClient over FetchTransport. Returns the same values as SoqlClientImpl for the same org responses. */
export class FetchSoqlClient implements SoqlClient {
  constructor(private readonly t: FetchTransport) {}

  async query<T>(soql: string): Promise<QueryResult<T>> {
    const page = await this.firstPage<T>(soql);
    return { totalSize: page.totalSize, done: page.done, records: page.records ?? [] };
  }

  async queryAll<T>(soql: string): Promise<T[]> {
    const first = await this.firstPage<T>(soql);
    return collectPages<T>(first, (url) => this.t.getJson<QueryPage<T>>(url));
  }

  private firstPage<T>(soql: string): Promise<QueryPage<T>> {
    return this.t.getJson<QueryPage<T>>('query?q=' + encodeURIComponent(soql));
  }
}
