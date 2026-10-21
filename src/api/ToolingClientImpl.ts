import type { Connection } from '@salesforce/core';
import { normaliseApiError } from './ApiError.js';
import { collectPages, type QueryPage } from './paging.js';
import type { ToolingClient } from './ToolingClient.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTooling = { query(soql: string): Promise<any> };

export class ToolingClientImpl implements ToolingClient {
  private readonly tooling: AnyTooling;

  constructor(private readonly conn: Connection) {
    this.tooling = conn.tooling as unknown as AnyTooling;
  }

  async query<T>(soql: string): Promise<T[]> {
    try {
      const result = await this.tooling.query(soql);
      // conn.request() follows nextRecordsUrl; tooling.queryMore has awkward overload typings.
      return await collectPages<T>(result, (url) => this.conn.request<QueryPage<T>>(url));
    } catch (e) {
      throw normaliseApiError(e);
    }
  }

  async getRecord<T>(type: string, id: string): Promise<T> {
    const version = this.conn.getApiVersion();
    try {
      return await this.conn.request<T>(
        `/services/data/v${version}/tooling/sobjects/${type}/${id}/`
      );
    } catch (e) {
      throw normaliseApiError(e);
    }
  }
}
