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
 * The 20 known RTE types. `store` is declared wherever a `*Store` counterpart is known to
 * exist; its absence on ListViewEvent is deliberate, not an oversight.
 */
export const RTE_CATALOG: readonly RteType[] = [
  { base: 'ListViewEvent', preferredFields: ALL_PREFERRED },
  { base: 'ApiEvent', store: 'ApiEventStore', preferredFields: ALL_PREFERRED },
  { base: 'LoginEvent', store: 'LoginEventStore', preferredFields: ALL_PREFERRED },
  { base: 'LogoutEvent', store: 'LogoutEventStore', preferredFields: ALL_PREFERRED },
  { base: 'ReportEvent', store: 'ReportEventStore', preferredFields: ALL_PREFERRED },
  { base: 'UriEvent', store: 'UriEventStore', preferredFields: ALL_PREFERRED },
  { base: 'LightningUriEvent', store: 'LightningUriEventStore', preferredFields: ALL_PREFERRED },
  { base: 'ApexExecutionEvent', preferredFields: ALL_PREFERRED },
  { base: 'BulkApiResultEvent', store: 'BulkApiResultEventStore', preferredFields: ALL_PREFERRED },
  { base: 'FileEvent', store: 'FileEventStore', preferredFields: ALL_PREFERRED },
  { base: 'ApiAnomalyEvent', store: 'ApiAnomalyEventStore', preferredFields: ALL_PREFERRED },
  {
    base: 'GuestUserAnomalyEvent',
    store: 'GuestUserAnomalyEventStore',
    preferredFields: ALL_PREFERRED,
  },
  {
    base: 'SessionHijackingEvent',
    store: 'SessionHijackingEventStore',
    preferredFields: ALL_PREFERRED,
  },
  {
    base: 'CredentialStuffingEvent',
    store: 'CredentialStuffingEventStore',
    preferredFields: ALL_PREFERRED,
  },
  { base: 'ReportAnomalyEvent', store: 'ReportAnomalyEventStore', preferredFields: ALL_PREFERRED },
  { base: 'PermissionSetEvent', store: 'PermissionSetEventStore', preferredFields: ALL_PREFERRED },
  {
    base: 'ConcurLongRunApexErrEvent',
    store: 'ConcurLongRunApexErrEventStore',
    preferredFields: ALL_PREFERRED,
  },
  { base: 'OrgLifecycleNotification', preferredFields: ALL_PREFERRED },
  { base: 'LoginAsEvent', store: 'LoginAsEventStore', preferredFields: ALL_PREFERRED },
  { base: 'IdentityProviderEventStore', preferredFields: ALL_PREFERRED },
];
