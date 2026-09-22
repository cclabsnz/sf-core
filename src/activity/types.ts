/** What an operation did to data. `unknown` is a real answer, not a fallback. */
export type ActivityKind = 'read' | 'write' | 'destructive' | 'control' | 'unknown';

/** One parsed row of an EventLogFile log body. Not the EventLogFileRow metadata record. */
export type CsvRecord = Readonly<Record<string, string>>;

export interface ActivityEvent {
  /** ISO 8601, millisecond precision, UTC. */
  at: string;
  /** As captured: a username from USER_NAME, or an id from USER_ID. */
  actor: string;
  /** Present when the source carries an id as well as, or instead of, a name. */
  actorId?: string;
  /** CONNECTED_APP_NAME. Absent for CLI traffic, which the logs leave blank. */
  app?: string;
  /** SOAP | REST | BULK, verbatim from the log. */
  family: string;
  /** query | create | update | GET | POST — the operation, however the log spells it. */
  operation: string;
  entity?: string;
  /** API_RESOURCE or URI. */
  resource?: string;
  kind: ActivityKind;
  /** The composite join key. */
  requestId?: string;
  sourceIp?: string;
  status?: string;
  /** The EventLogFile type this came from. */
  eventType: string;
  /** Verbatim Salesforce field names, so a row can be traced back to the org. */
  raw: CsvRecord;
  /** Set on a composite container whose subrequests were resolved. Its own `kind` stays
   *  `unknown` because a container has no operation of its own — consumers should exclude
   *  marked events from totals rather than counting them as unclassified. */
  decomposedInto?: number;
}

export interface KindCounts {
  read: number;
  write: number;
  destructive: number;
  control: number;
  unknown: number;
}

export interface Run {
  from: string;
  to: string;
  count: number;
  kinds: KindCounts;
  durationMs: number;
  ratePerSec: number;
  /** Distinct apps seen, so a shared identity is visible rather than averaged away. */
  apps: string[];
}

export interface Cycle {
  from: string;
  to: string;
  count: number;
  kinds: KindCounts;
  durationMs: number;
  /** Caller-counted unit of work. Never below 1. */
  units: number;
  msPerUnit: number;
  /** False for a trailing group with no delimiter. */
  complete: boolean;
  steps: ActivityEvent[];
}

export interface OutlierFlag<T> {
  item: T;
  value: number;
  severity: 'slow' | 'hung' | null;
}

export interface OutlierReport<T> {
  flags: Array<OutlierFlag<T>>;
  median: number;
  mad: number;
  /** True below 12 items: a prompt to look, not proof. */
  underpowered: boolean;
}

export interface Transition {
  from: string;
  to: string;
  count: number;
  /** Fraction of all transitions, 0..1. */
  share: number;
}

export interface MotifReport {
  transitions: Transition[];
  /** Transitions inside the dominant share, most frequent first. */
  dominant: Transition[];
  /** The remainder — where the actor departed from its own pattern. */
  offPattern: Transition[];
}

export interface CompositeJoinResult {
  events: ActivityEvent[];
  /** Parents whose children were found and attached. */
  resolved: number;
  /** Parents left `unknown` because no children were available. */
  unresolved: number;
  /** Children with no parent in the input. Retained, never dropped. */
  orphans: number;
  /** Parents sharing a requestId already resolved. Retained as events, children not re-attached. */
  duplicates: number;
}
