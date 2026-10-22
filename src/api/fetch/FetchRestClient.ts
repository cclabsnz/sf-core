import { SalesforceApiError } from '../ApiError.js';
import type { RestClient } from '../RestClient.js';
import { streamToFile } from '../streamToFile.js';
import type { FetchTransport } from './FetchTransport.js';

/** RestClient over FetchTransport. Returns the same values as RestClientImpl for the same org responses. */
export class FetchRestClient implements RestClient {
  constructor(private readonly t: FetchTransport) {}

  get<T>(path: string): Promise<T> {
    return this.t.getJson<T>(path);
  }

  getRaw(path: string): Promise<string> {
    return this.t.getText(path);
  }

  async getRawToFile(path: string, destPath: string): Promise<number> {
    const res = await this.t.get(path, '*/*');
    if (!res.body) {
      throw new SalesforceApiError('EMPTY_BODY', `The org returned no body for ${path}.`, { statusCode: res.status });
    }
    return streamToFile(res.body, destPath);
  }
}
