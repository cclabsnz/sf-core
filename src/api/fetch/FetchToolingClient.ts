import { collectPages, type QueryPage } from '../paging.js';
import type { ToolingClient } from '../ToolingClient.js';
import type { FetchTransport } from './FetchTransport.js';

/** ToolingClient over FetchTransport. Returns the same values as ToolingClientImpl for the same org responses. */
export class FetchToolingClient implements ToolingClient {
  constructor(private readonly t: FetchTransport) {}

  async query<T>(soql: string): Promise<T[]> {
    const first = await this.t.getJson<QueryPage<T>>('tooling/query?q=' + encodeURIComponent(soql));
    return collectPages<T>(first, (url) => this.t.getJson<QueryPage<T>>(url));
  }

  getRecord<T>(type: string, id: string): Promise<T> {
    return this.t.getJson<T>('tooling/sobjects/' + type + '/' + id + '/');
  }
}
