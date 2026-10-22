import type { Connection } from '@salesforce/core';
import { normaliseApiError } from './ApiError.js';
import { collectPages, type PagingOptions, type QueryPage } from './paging.js';
import type { QueryResult, SoqlClient } from './SoqlClient.js';

// AnyConn widens the return types of Connection methods to avoid
// complex jsforce generic overloads in this layer
type AnyConn = Connection & {
  query(soql: string): Promise<any>;
  request(url: string): Promise<any>;
};

export class SoqlClientImpl implements SoqlClient {
  private readonly anyConn: AnyConn;

  constructor(conn: Connection, private readonly paging: PagingOptions = {}) {
    this.anyConn = conn as AnyConn;
  }

  async query<T>(soql: string): Promise<QueryResult<T>> {
    try {
      const result = await this.anyConn.query(soql);
      return {
        totalSize: result.totalSize as number,
        done: result.done as boolean,
        records: (result.records ?? []) as T[],
      };
    } catch (e) {
      throw normaliseApiError(e);
    }
  }

  async queryAll<T>(soql: string): Promise<T[]> {
    try {
      // First page without autoFetch (which caps at 10k), then the shared pager.
      const first = (await this.anyConn.query(soql)) as QueryPage<T>;
      return await collectPages<T>(first, (url) => this.anyConn.request(url), this.paging);
    } catch (e) {
      throw normaliseApiError(e);
    }
  }
}
