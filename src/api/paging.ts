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
 *
 * A child relationship (subquery) field that carries its own nextRecordsUrl is followed too,
 * as jsforce's autoFetch did (query.js `_fetchAllSubqueryRecords`): the field becomes
 * `{ ...field, records: <all>, done: true, nextRecordsUrl: undefined }`. Child pages count
 * toward the page cap.
 */
export async function collectPages<T>(
  first: QueryPage<T>,
  fetchNext: (nextRecordsUrl: string) => Promise<QueryPage<T>>
): Promise<T[]> {
  let pages = 1;
  const follow = async <P>(url: string): Promise<QueryPage<P>> => {
    if (pages >= MAX_QUERY_PAGES) {
      throw new SalesforceApiError(
        'QUERY_TOO_LARGE',
        `The query returned more than ${MAX_QUERY_PAGES} pages; narrow the query (for sf-evidence, a shorter time slice). No partial result is returned.`
      );
    }
    pages++;
    return (await fetchNext(url)) as unknown as QueryPage<P>;
  };

  let page = first;
  let records = await expandChildPages(page.records ?? [], follow);
  while (page.nextRecordsUrl) {
    page = await follow<T>(page.nextRecordsUrl);
    records = records.concat(await expandChildPages(page.records ?? [], follow));
  }
  return records;
}

/** Each record with every partial child relationship followed to completion, in order. */
async function expandChildPages<T>(
  records: T[],
  follow: <P>(url: string) => Promise<QueryPage<P>>
): Promise<T[]> {
  const out: T[] = [];
  for (const record of records) {
    if (typeof record !== 'object' || record === null) {
      out.push(record);
      continue;
    }
    let expanded: Record<string, unknown> | undefined;
    for (const [key, field] of Object.entries(record as Record<string, unknown>)) {
      // jsforce's test: an object with both `records` and `nextRecordsUrl` keys.
      if (!field || typeof field !== 'object' || !('records' in field) || !('nextRecordsUrl' in field)) continue;
      const child = field as QueryPage<unknown>;
      let all: unknown[] = child.records ? [...child.records] : [];
      let next = child.records ? child.nextRecordsUrl : undefined;
      while (next) {
        const more = await follow<unknown>(next);
        all = all.concat(more.records ?? []);
        next = more.nextRecordsUrl;
      }
      expanded ??= { ...(record as Record<string, unknown>) };
      expanded[key] = { ...child, records: all, done: true, nextRecordsUrl: undefined };
    }
    out.push((expanded ?? record) as T);
  }
  return out;
}
