// Pure helpers for the `audit events pull` command. Kept free of I/O so they are
// unit-testable without an org connection or the oclif command harness.

/** Which EventLogFile Interval to discover. `both` omits the predicate entirely. */
export type EventLogInterval = 'Daily' | 'Hourly' | 'both';

/** An explicit, bounded LogDate window. Both bounds are inclusive ISO8601 instants. */
export interface EventLogWindow {
  from: string;
  to: string;
}

export interface EventLogQueryOptions {
  /** Number of days of LogDate to request (LAST_N_DAYS:N). Mutually exclusive with `window`. */
  since?: number;
  /** Explicit LogDate bounds. Mutually exclusive with `since`. */
  window?: EventLogWindow;
  /** Defaults to 'Daily', which preserves the free-tier behaviour byte-for-byte. */
  interval?: EventLogInterval;
  /** Optional EventType allow-list (already sanitised or not — we sanitise again). */
  types?: string[];
}

/**
 * The EventTypes worth capturing hourly. Deliberately a short list: hourly capture of every
 * type runs to ~25GB/month on a busy org, against ~1–2GB for these. They are the types that
 * carry either the access evidence itself or the join keys (REQUEST_ID, CLIENT_IP,
 * SESSION_KEY, LOGIN_KEY) a consumer needs to tie types together.
 *
 * Exported as data so downstream packages can name the same default rather than duplicate it.
 */
export const HOURLY_FORENSIC_CORE = [
  'AuraRequest',
  'Sites',
  'URI',
  'UniqueQuery',
  'GraphQlQueryExecution',
  'ApexExecution',
  'RestApi',
  'API',
  'Login',
  'Logout',
] as const;

/**
 * Reduce free-form `--types` input to safe EventType tokens. EventTypes are PascalCase
 * identifiers (Login, ApiTotalUsage, LightningError, …), so we strip anything that is not
 * alphanumeric. This doubles as the SOQL-injection guard for the IN clause.
 */
export function sanitizeTypes(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((t) => t.replace(/[^A-Za-z0-9]/g, '').trim())
    .filter((t) => t.length > 0);
}

/** Normalise a Salesforce LogDate (datetime) to a YYYY-MM-DD string for filenames. */
export function toLogDate(raw: string): string {
  return String(raw).slice(0, 10);
}

/**
 * Extract the zero-padded UTC hour ('00'–'23') from a Salesforce LogDate. Returns undefined
 * when the value carries no time component, which is how a Daily row is told from an Hourly
 * one without trusting the Interval field alone.
 */
export function toLogHour(raw: string): string | undefined {
  const match = /T(\d{2}):/.exec(String(raw));
  return match ? match[1] : undefined;
}

/**
 * Salesforce rejects a bare ISO instant in SOQL if it carries milliseconds or a `Z` the
 * driver has not normalised, so bounds are validated to the shape the platform accepts and
 * interpolated only once proven safe. Anything else throws rather than reaching the org.
 */
const SOQL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function assertDateTime(value: string, label: string): string {
  if (!SOQL_DATETIME.test(value)) {
    throw new TypeError(
      `Invalid ${label} '${value}': expected an ISO8601 datetime such as 2026-08-02T04:00:00Z`,
    );
  }
  return value;
}

/**
 * Build the read-only EventLogFile discovery query.
 *
 * `Interval = 'Daily'` (the default) excludes the paid hourly logs and emits exactly the SOQL
 * this function has always emitted — free-tier callers are unaffected. `'Hourly'` selects the
 * paid logs; `'both'` omits the predicate rather than emitting `IN ('Daily','Hourly')`, which
 * is the same result set with fewer moving parts.
 *
 * NOTE: never probe for hourly rows with a `GROUP BY Interval` aggregate. A verified quirk of
 * the platform is that such a query reports only `Daily` even in orgs where an explicit
 * `WHERE Interval = 'Hourly'` returns thousands of rows.
 *
 * `since` is coerced to a non-negative integer, `window` bounds are shape-validated and
 * `types` are sanitised, so the interpolated string is injection-safe.
 */
export function buildEventLogQuery(opts: EventLogQueryOptions): string {
  if (opts.since !== undefined && opts.window !== undefined) {
    throw new TypeError('buildEventLogQuery: `since` and `window` are mutually exclusive');
  }
  if (opts.since === undefined && opts.window === undefined) {
    throw new TypeError('buildEventLogQuery: one of `since` or `window` is required');
  }

  const interval = opts.interval ?? 'Daily';
  const intervalClause = interval === 'both' ? '' : `Interval = '${interval}' AND `;

  const dateClause = opts.window
    ? `LogDate >= ${assertDateTime(opts.window.from, 'window.from')} AND ` +
      `LogDate <= ${assertDateTime(opts.window.to, 'window.to')}`
    : `LogDate = LAST_N_DAYS:${Math.max(0, Math.trunc(opts.since as number))}`;

  const types = (opts.types ?? []).filter((t) => t.length > 0);
  const typeClause =
    types.length > 0 ? ` AND EventType IN (${types.map((t) => `'${t}'`).join(', ')})` : '';

  return (
    'SELECT Id, EventType, LogDate, LogFileLength, Interval, LogFileFieldNames ' +
    'FROM EventLogFile ' +
    `WHERE ${intervalClause}${dateClause}${typeClause} ` +
    'ORDER BY LogDate'
  );
}
