// src/events/rteCatalog.ts
// Static description of the Real-Time Event Monitoring objects worth capturing. Data only —
// no logic, no I/O — so the probe in pullRealtimeEvents stays the single place that decides
// what an org can actually serve.
//
// Two verified facts drive the shape of this table:
//
//   1. Roughly half the RTE base objects reject `SELECT ... FROM x` outright with "entity type
//      x does not support query" while their `*Store` counterpart answers fine. The Store holds
//      the retained rows; the base object is the streaming channel.
//   2. The base/Store split is NOT uniform and cannot be derived from the name. ListViewEvent
//      is queryable and has no ListViewEventStore at all; GuestUserAnomalyEvent is the exact
//      inverse. Hence: declare both names, probe at runtime, believe the org.

export interface RteType {
  /** The streaming/base object name, e.g. 'ListViewEvent'. Probed first. */
  base: string;
  /** The retained-rows counterpart, e.g. 'GuestUserAnomalyEventStore'. Probed on fallback. */
  store?: string;
  /** Forensic fields in priority order; intersected with describe() at runtime. */
  preferredFields: string[];
}

/**
 * Fields every RTE object is asked for when it defines them. Field sets differ per object —
 * LightningUriEvent has no RowsProcessed, for one — so a fixed SELECT list across objects
 * fails outright. The intersection with describe() is what makes a shared list workable.
 */
const COMMON_FIELDS = [
  'EventDate',
  'SourceIp',
  'Username',
  'UserId',
  'SessionKey',
  'LoginKey',
  'EventIdentifier',
  'RelatedEventIdentifier',
];

/**
 * The fields that answer *did any records actually leave*. EventLogFile cannot answer this —
 * it records no response bodies and no row counts for Aura actions — which is precisely why
 * RTE capture exists. Requested wherever the object defines them.
 */
const EXFIL_FIELDS = ['RowsProcessed', 'QueriedEntities', 'Records'];

/** Query/'what was asked for' context, where present. */
const CONTEXT_FIELDS = [
  'Query',
  'Operation',
  'Name',
  'DeveloperName',
  'Scope',
  'FilterCriteria',
  'Status',
  'Platform',
  'Application',
];

const ALL_PREFERRED = [...COMMON_FIELDS, ...EXFIL_FIELDS, ...CONTEXT_FIELDS];

/**
 * The 20 known RTE types, split by how the org actually serves them.
 *
 * Probed against a live sandbox on 2026-08-03, which replaced the naming convention this
 * table was first built on. The convention was wrong in both directions, and the real rule
 * turns out to be about what kind of event it is:
 *
 *   - **Audit events** (someone did a thing) are queried directly and have NO `*Store`.
 *     `ApiEventStore`, `LoginEventStore`, `LogoutEventStore`, `ReportEventStore`,
 *     `UriEventStore`, `LightningUriEventStore` and `LoginAsEventStore` were all declared
 *     here and none of them exist — every one 404s on describe.
 *   - **Threat-detection events** (something looked wrong) are streaming-only: the base
 *     rejects a query outright and the retained rows live in a `*Store`.
 *
 * A `store` on a directly-queryable base is never reached, so the phantom entries were
 * harmless — but a catalog that documents objects which do not exist is worse than no
 * documentation, so they are gone.
 *
 * Re-probed across five orgs — two sandboxes and three production — on 2026-08-03. Every
 * verdict was identical in all five, including the absences, so the negatives are no longer
 * a single-org observation that a different licence might overturn.
 */
export const RTE_CATALOG: readonly RteType[] = [
  // Directly queryable; no Store counterpart exists. Verified queryable in the probe org.
  { base: 'ListViewEvent', preferredFields: ALL_PREFERRED },
  { base: 'ApiEvent', preferredFields: ALL_PREFERRED },
  { base: 'LoginEvent', preferredFields: ALL_PREFERRED },
  { base: 'LogoutEvent', preferredFields: ALL_PREFERRED },
  { base: 'ReportEvent', preferredFields: ALL_PREFERRED },
  { base: 'UriEvent', preferredFields: ALL_PREFERRED },
  { base: 'LightningUriEvent', preferredFields: ALL_PREFERRED },
  { base: 'LoginAsEvent', preferredFields: ALL_PREFERRED },
  { base: 'IdentityProviderEventStore', preferredFields: ALL_PREFERRED },

  // Streaming-only base, retained rows in the Store. All eight Stores verified queryable,
  // and all eight bases verified to reject a query with "does not support query".
  { base: 'ApiAnomalyEvent', store: 'ApiAnomalyEventStore', preferredFields: ALL_PREFERRED },
  { base: 'BulkApiResultEvent', store: 'BulkApiResultEventStore', preferredFields: ALL_PREFERRED },
  {
    base: 'CredentialStuffingEvent',
    store: 'CredentialStuffingEventStore',
    preferredFields: ALL_PREFERRED,
  },
  { base: 'FileEvent', store: 'FileEventStore', preferredFields: ALL_PREFERRED },
  {
    base: 'GuestUserAnomalyEvent',
    store: 'GuestUserAnomalyEventStore',
    preferredFields: ALL_PREFERRED,
  },
  { base: 'PermissionSetEvent', store: 'PermissionSetEventStore', preferredFields: ALL_PREFERRED },
  { base: 'ReportAnomalyEvent', store: 'ReportAnomalyEventStore', preferredFields: ALL_PREFERRED },
  {
    base: 'SessionHijackingEvent',
    store: 'SessionHijackingEventStore',
    preferredFields: ALL_PREFERRED,
  },

  // Exist, but are streaming-only with no Store in any org probed — so they can never be
  // captured retroactively. Kept deliberately: the manifest recording them as `not-queryable`
  // is real coverage information. "This event type exists and cannot be read after the fact"
  // is a different answer from "we did not look", and a forensic consumer needs to tell them
  // apart before it reports an absence.
  { base: 'ConcurLongRunApexErrEvent', preferredFields: ALL_PREFERRED },
  { base: 'OrgLifecycleNotification', preferredFields: ALL_PREFERRED },

  // `ApexExecutionEvent` was here and is gone: absent from describe in all five orgs, so the
  // name appears not to exist rather than to be unlicensed. It cost a 404 per pull.
];
