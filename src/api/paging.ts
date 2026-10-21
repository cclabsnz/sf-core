import { SalesforceApiError } from './ApiError.js';

/** One page of a SOQL or Tooling query response, in Salesforce's own shape. */
export interface QueryPage<T> {
  totalSize: number;
  done: boolean;
  records: T[];
  nextRecordsUrl?: string;
}

/** Hard cap on pages followed: 200 pages of up to 2000 rows is 400 000 records. */
export const MAX_QUERY_PAGES = 200;

/**
 * Follow nextRecordsUrl until it is absent and return every record. Exceeding
 * MAX_QUERY_PAGES throws; a partial result is never returned.
 */
export async function collectPages<T>(
  first: QueryPage<T>,
  fetchNext: (nextRecordsUrl: string) => Promise<QueryPage<T>>
): Promise<T[]> {
  let records: T[] = first.records ?? [];
  let nextUrl = first.nextRecordsUrl;
  let pages = 1;
  while (nextUrl) {
    if (pages >= MAX_QUERY_PAGES) {
      throw new SalesforceApiError(
        'QUERY_TOO_LARGE',
        `The query returned more than ${MAX_QUERY_PAGES} pages; narrow the query (for sf-evidence, a shorter time slice). No partial result is returned.`
      );
    }
    const next = await fetchNext(nextUrl);
    pages++;
    records = records.concat(next.records ?? []);
    nextUrl = next.nextRecordsUrl;
  }
  return records;
}
