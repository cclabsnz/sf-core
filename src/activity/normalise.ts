import { classify } from './classify.js';
import type { ActivityEvent, CsvRecord } from './types.js';

/** Trim, and treat the empty string as absent. Logs use '' where a field does not apply. */
function opt(v: string | undefined): string | undefined {
  const t = (v ?? '').trim();
  return t === '' ? undefined : t;
}

/**
 * Normalise a log timestamp to ISO 8601 UTC with milliseconds.
 *
 * Returns undefined for anything unparseable, which causes the row to be skipped. An event with
 * no time cannot be sequenced, and a fabricated time would be worse than a missing row.
 */
function toIso(v: string | undefined): string | undefined {
  const raw = (v ?? '').trim();
  if (raw === '') return undefined;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms).toISOString();
}

interface Adapter {
  (row: CsvRecord, eventType: string): ActivityEvent | undefined;
}

const apiTotalUsage: Adapter = (row, eventType) => {
  const at = toIso(row.TIMESTAMP_DERIVED ?? row.TIMESTAMP);
  if (at === undefined) return undefined;
  const family = opt(row.API_FAMILY) ?? 'REST';
  // SOAP leaves HTTP_METHOD blank and puts the operation name in API_RESOURCE.
  const isSoap = family.toLowerCase() === 'soap';
  const resource = opt(row.API_RESOURCE);
  const operation = (isSoap ? resource : opt(row.HTTP_METHOD)) ?? '';
  return {
    at,
    actor: opt(row.USER_NAME) ?? opt(row.USER_ID) ?? '',
    actorId: opt(row.USER_ID),
    app: opt(row.CONNECTED_APP_NAME),
    family,
    operation,
    entity: opt(row.ENTITY_NAME),
    resource: isSoap ? undefined : resource,
    kind: classify({ family, operation, resource: isSoap ? undefined : resource }),
    requestId: opt(row.REQUEST_ID),
    sourceIp: opt(row.CLIENT_IP),
    status: opt(row.STATUS_CODE),
    eventType,
    raw: row,
  };
};

const restApi: Adapter = (row, eventType) => {
  const at = toIso(row.TIMESTAMP_DERIVED ?? row.TIMESTAMP);
  if (at === undefined) return undefined;
  const operation = opt(row.METHOD) ?? '';
  const resource = opt(row.URI);
  const actorId = opt(row.USER_ID_DERIVED) ?? opt(row.USER_ID);
  return {
    at,
    actor: actorId ?? '',
    actorId,
    // Deliberately not mapped. RestApi carries CONNECTED_APP_ID, not a name, and its id space
    // differs from ApiTotalUsage's for the same app — the two logs use different id prefixes —
    // so writing it into `app` — documented as CONNECTED_APP_NAME — would make one app appear
    // as two in any grouping. Attribution for composite children comes from the parent instead.
    // See the "do not join two event types on connected-app id" rule in the design.
    app: undefined,
    family: 'REST',
    operation,
    entity: opt(row.ENTITY_NAME),
    resource,
    kind: classify({ family: 'REST', operation, resource }),
    requestId: opt(row.REQUEST_ID),
    sourceIp: opt(row.CLIENT_IP),
    status: opt(row.STATUS_CODE),
    eventType,
    raw: row,
  };
};

const compositeSubrequest: Adapter = (row, eventType) => {
  const at = toIso(row.TIMESTAMP_DERIVED ?? row.TIMESTAMP);
  if (at === undefined) return undefined;
  const operation = opt(row.METHOD) ?? '';
  const resource = opt(row.URI);
  const actorId = opt(row.USER_ID) ?? opt(row.USER_ID_DERIVED);
  return {
    at,
    actor: actorId ?? '',
    actorId,
    app: undefined,
    family: 'REST',
    operation,
    entity: undefined,
    resource,
    kind: classify({ family: 'REST', operation, resource }),
    requestId: opt(row.REQUEST_ID),
    sourceIp: opt(row.CLIENT_IP),
    status: opt(row.STATUS_CODE),
    eventType,
    raw: row,
  };
};

const legacyApi: Adapter = (row, eventType) => {
  const at = toIso(row.TIMESTAMP_DERIVED ?? row.TIMESTAMP);
  if (at === undefined) return undefined;
  const family = opt(row.API_TYPE) ?? 'SOAP';
  const operation = opt(row.METHOD_NAME) ?? '';
  return {
    at,
    actor: opt(row.USER_ID) ?? '',
    actorId: opt(row.USER_ID),
    app: opt(row.CLIENT_NAME),
    family,
    operation,
    entity: opt(row.ENTITY_NAME),
    resource: undefined,
    kind: classify({ family, operation }),
    requestId: opt(row.REQUEST_ID),
    sourceIp: opt(row.CLIENT_IP),
    status: undefined,
    eventType,
    raw: row,
  };
};

const login: Adapter = (row, eventType) => {
  const at = toIso(row.TIMESTAMP_DERIVED ?? row.TIMESTAMP);
  if (at === undefined) return undefined;
  return {
    at,
    actor: opt(row.USER_ID) ?? '',
    actorId: opt(row.USER_ID),
    app: opt(row.APP_NAME) ?? opt(row.APPLICATION),
    family: 'LOGIN',
    operation: 'login',
    entity: undefined,
    resource: undefined,
    kind: 'control',
    requestId: opt(row.REQUEST_ID),
    sourceIp: opt(row.CLIENT_IP) ?? opt(row.SOURCE_IP),
    status: opt(row.LOGIN_STATUS),
    eventType,
    raw: row,
  };
};

const ADAPTERS: Readonly<Record<string, Adapter>> = {
  ApiTotalUsage: apiTotalUsage,
  RestApi: restApi,
  CompositeApiSubrequest: compositeSubrequest,
  API: legacyApi,
  Login: login,
};

export const SUPPORTED_EVENT_TYPES: readonly string[] = Object.keys(ADAPTERS);

export function isSupportedEventType(eventType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ADAPTERS, eventType);
}

/**
 * Turn parsed log rows into ActivityEvents.
 *
 * Throws on an unsupported event type. Returning [] was rejected: an empty array is
 * indistinguishable from a captured-but-quiet day, and that confusion is the whole reason the
 * spec's failure-mode table exists.
 */
export function normalise(rows: readonly CsvRecord[], eventType: string): ActivityEvent[] {
  const adapter = ADAPTERS[eventType];
  if (adapter === undefined) {
    throw new Error(
      `No normaliser for EventLogFile type '${eventType}'. Supported: ${SUPPORTED_EVENT_TYPES.join(', ')}.`,
    );
  }
  const out: ActivityEvent[] = [];
  for (const row of rows) {
    const e = adapter(row, eventType);
    if (e !== undefined) out.push(e);
  }
  return out;
}
