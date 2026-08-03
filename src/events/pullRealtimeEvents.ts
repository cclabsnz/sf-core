// src/events/pullRealtimeEvents.ts
// Capture Real-Time Event Monitoring rows for a window. Read-only: a describe GET plus a
// SELECT per object, nothing else.
//
// Why this exists at all: EventLogFile records no response bodies and no row counts for Aura
// actions, so it cannot answer "did any records leave". RTE objects carry RowsProcessed,
// QueriedEntities and Records, and they answer it directly.
//
// This never throws. An org that cannot serve RTE is the common case, not an error, and a
// failed RTE probe must never take the ELF capture down with it.
import type { SoqlClient } from '../api/SoqlClient.js';
import type { RestClient } from '../api/RestClient.js';
import type { EventBaselineStore } from './EventBaselineStore.js';
import type {
  CapturedRteObject,
  SkipReason,
  UnavailableRteObject,
} from './CaptureManifest.js';
import { RTE_CATALOG, type RteType } from './rteCatalog.js';

export interface RealtimePullDeps {
  soql: SoqlClient;
  rest: RestClient;
  store: EventBaselineStore;
  orgId: string;
}

export interface RealtimePullOptions {
  /** Inclusive ISO8601 bounds. Rows are bucketed to one NDJSON file per UTC hour within it. */
  window: { from: string; to: string };
  /** Defaults to the full catalog. */
  catalog?: readonly RteType[];
  /** Re-capture object-hours already on disk. */
  force?: boolean;
  warn?: (msg: string) => void;
}

export interface RealtimePullResult {
  captured: CapturedRteObject[];
  unavailable: UnavailableRteObject[];
}

/** Shape of the fields array in an sObject describe response. */
interface DescribeResponse {
  fields?: Array<{ name?: string }>;
}

const SOQL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export async function pullRealtimeEvents(
  deps: RealtimePullDeps,
  opts: RealtimePullOptions,
): Promise<RealtimePullResult> {
  for (const bound of [opts.window.from, opts.window.to]) {
    if (!SOQL_DATETIME.test(bound)) {
      throw new TypeError(
        `pullRealtimeEvents: invalid window bound '${bound}': expected an ISO8601 datetime`,
      );
    }
  }

  const result: RealtimePullResult = { captured: [], unavailable: [] };

  for (const entry of opts.catalog ?? RTE_CATALOG) {
    const outcome = await captureOne(deps, opts, entry);
    if ('reason' in outcome) result.unavailable.push(outcome);
    else result.captured.push(outcome);
  }

  return result;
}

/** Probe base, fall back to store, classify whatever went wrong. Never rejects. */
async function captureOne(
  deps: RealtimePullDeps,
  opts: RealtimePullOptions,
  entry: RteType,
): Promise<CapturedRteObject | UnavailableRteObject> {
  const attempts: Array<{ name: string; via: 'base' | 'store' }> = [
    { name: entry.base, via: 'base' },
  ];
  if (entry.store) attempts.push({ name: entry.store, via: 'store' });

  const details: string[] = [];
  let lastReason: SkipReason = 'unknown';

  for (const attempt of attempts) {
    let fields: string[];
    try {
      fields = await describeFields(deps.rest, attempt.name, entry.preferredFields);
    } catch (err) {
      lastReason = classifyRteError(err);
      details.push(`${attempt.name}: describe failed (${message(err)})`);
      continue;
    }

    if (fields.length === 0) {
      // The object exists (describe answered) but defines none of the forensic fields, so
      // there is no SELECT list to build. Not a licence problem — genuinely unexpected.
      lastReason = 'unknown';
      details.push(`${attempt.name}: describe returned none of the preferred fields`);
      continue;
    }

    let rows: Array<Record<string, unknown>>;
    try {
      rows = await deps.soql.queryAll<Record<string, unknown>>(
        buildRealtimeQuery(attempt.name, fields, opts.window),
      );
    } catch (err) {
      lastReason = classifyRteError(err);
      details.push(`${attempt.name}: ${message(err)}`);
      continue;
    }

    if (rows.length === 0) {
      if (attempt.via === 'base') {
        // The live event channel answered and had nothing. That is a real finding — nothing
        // happened in this window — not a gap in capture, so it is recorded as a capture of
        // zero rows rather than as an unavailable object.
        return { object: entry.base, rows: 0, via: 'base', paths: [] };
      }
      // Only the retained-rows Store answered, and it is empty. Empty and never-retained are
      // indistinguishable from here, so this must not be reported as "nothing happened".
      lastReason = 'storage-disabled';
      details.push(`${attempt.name}: queryable but returned 0 rows`);
      continue;
    }

    return writeBuckets(deps, opts, entry.base, attempt.via, rows);
  }

  return {
    object: entry.base,
    reason: lastReason,
    detail: details.join('; ') || undefined,
  };
}

/**
 * Bucket rows into one NDJSON file per UTC hour and write them. Rows whose EventDate is
 * missing or unparseable land in the window-start bucket rather than being dropped — an
 * unattributable row is still evidence.
 */
function writeBuckets(
  deps: RealtimePullDeps,
  opts: RealtimePullOptions,
  objectName: string,
  via: 'base' | 'store',
  rows: Array<Record<string, unknown>>,
): CapturedRteObject {
  const fallback = bucketKey(opts.window.from) ?? { date: opts.window.from.slice(0, 10), hour: '00' };
  const buckets = new Map<string, { date: string; hour: string; rows: Array<Record<string, unknown>> }>();

  for (const row of rows) {
    const key = bucketKey(row.EventDate) ?? fallback;
    const id = `${key.date}T${key.hour}`;
    const bucket = buckets.get(id) ?? { ...key, rows: [] };
    bucket.rows.push(row);
    buckets.set(id, bucket);
  }

  const paths: string[] = [];
  let written = 0;

  for (const bucket of buckets.values()) {
    if (!opts.force && deps.store.hasRealtime(deps.orgId, objectName, bucket.date, bucket.hour)) {
      paths.push(deps.store.realtimePathFor(deps.orgId, objectName, bucket.date, bucket.hour));
      continue;
    }
    // ORDER BY EventDate is rejected outright on RTE objects ("Unsupported order direction on
    // filter column: EVENTDATE"), so ordering happens here instead.
    bucket.rows.sort((a, b) => String(a.EventDate ?? '').localeCompare(String(b.EventDate ?? '')));
    paths.push(deps.store.saveRealtime(deps.orgId, objectName, bucket.date, bucket.hour, bucket.rows));
    written += bucket.rows.length;
  }

  return { object: objectName, rows: written, via, paths };
}

function bucketKey(raw: unknown): { date: string; hour: string } | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):/.exec(String(raw ?? ''));
  return match ? { date: match[1], hour: match[2] } : undefined;
}

/**
 * Intersect the preferred field list with what the object actually defines. Field sets differ
 * per object — LightningUriEvent has no RowsProcessed — so a fixed SELECT list fails outright.
 */
export async function describeFields(
  rest: RestClient,
  objectName: string,
  preferred: readonly string[],
): Promise<string[]> {
  const describe = await rest.get<DescribeResponse>(`/sobjects/${objectName}/describe`);
  const actual = new Set((describe.fields ?? []).map((f) => String(f.name ?? '').toLowerCase()));
  return preferred.filter((f) => actual.has(f.toLowerCase()));
}

/**
 * Build the RTE window query. Deliberately emits no ORDER BY: RTE objects reject
 * `ORDER BY EventDate ASC` with "Unsupported order direction on filter column". Sorting is a
 * client-side concern here.
 */
export function buildRealtimeQuery(
  objectName: string,
  fields: readonly string[],
  window: { from: string; to: string },
): string {
  const safeObject = objectName.replace(/[^A-Za-z0-9_]/g, '');
  const safeFields = fields.map((f) => f.replace(/[^A-Za-z0-9_]/g, '')).filter((f) => f.length > 0);
  return (
    `SELECT ${safeFields.join(', ')} FROM ${safeObject} ` +
    `WHERE EventDate >= ${window.from} AND EventDate <= ${window.to}`
  );
}

/**
 * Map an RTE failure to a manifest reason. The distinction that matters most is
 * "does not support query" — meaning the base object is streaming-only and the Store should be
 * tried — versus a licence or permission wall, where trying harder will not help.
 */
export function classifyRteError(err: unknown): SkipReason {
  const msg = message(err).toLowerCase();
  if (msg.includes('does not support query')) return 'not-queryable';
  if (msg.includes('insufficient') || msg.includes('permission')) return 'no-permission';
  if (
    msg.includes('invalid type') ||
    msg.includes('not found') ||
    msg.includes('sobject type') ||
    msg.includes('licens') ||
    msg.includes('not enabled')
  ) {
    return 'unlicensed';
  }
  return 'unknown';
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
