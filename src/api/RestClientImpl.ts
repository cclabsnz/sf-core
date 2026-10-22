import type { Connection } from '@salesforce/core';
import { SalesforceApiError, apiErrorFromResponse, normaliseApiError } from './ApiError.js';
import { streamToFile } from './streamToFile.js';
import type { RestClient } from './RestClient.js';

export class RestClientImpl implements RestClient {
  constructor(private readonly conn: Connection) {}

  async get<T>(path: string): Promise<T> {
    const version = this.conn.getApiVersion();
    const normalised = path.startsWith('/') ? path : `/${path}`;
    try {
      return await this.conn.request<T>(`/services/data/v${version}${normalised}`);
    } catch (e) {
      throw normaliseApiError(e);
    }
  }

  async getRaw(path: string): Promise<string> {
    const version = this.conn.getApiVersion();
    const normalised = path.startsWith('/') ? path : `/${path}`;
    // jsforce returns the raw body string for non-JSON content types (text/csv here).
    try {
      return await this.conn.request<string>(`/services/data/v${version}${normalised}`);
    } catch (e) {
      throw normaliseApiError(e);
    }
  }

  async getRawToFile(path: string, destPath: string): Promise<number> {
    const version = this.conn.getApiVersion();
    const normalised = path.startsWith('/') ? path : `/${path}`;
    // Stream directly from the org to disk with the session bearer token, so the body is never
    // materialised as a JS string (which would fail on logs larger than ~512 MB).
    const url = `${this.conn.instanceUrl}/services/data/v${version}${normalised}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.conn.accessToken ?? ''}` },
    });
    if (!res.ok) throw await apiErrorFromResponse(res);
    if (!res.body) throw new SalesforceApiError('EMPTY_BODY', `The org returned no body for ${normalised}.`, { statusCode: res.status });
    return streamToFile(res.body, destPath);
  }
}
