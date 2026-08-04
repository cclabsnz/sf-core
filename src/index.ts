// @cclabsnz/sf-core — shared platform layer for CloudCounsel Salesforce sf plugins.

// --- API clients ---
export * from './api/index.js';
export type { MetadataClient } from './api/MetadataClient.js';
export { MetadataClientImpl } from './api/MetadataClientImpl.js';

// --- Org context ---
export type { OrgInfo } from './context/OrgInfo.js';
export type { OrgMetrics } from './context/OrgMetrics.js';
export { EMPTY_METRICS } from './context/OrgMetrics.js';
export type { AuditOptions, AuditContext } from './context/AuditContext.js';
export type {
  HealthCheckRisk,
  ApexClassBody,
  VfPageBody,
  EventLogAccess,
  EventLogSummary,
  AgentAccess,
  AgentDefinition,
  AgentUser,
  CspTrustedSite,
  MfaRegistration,
  EffectivePermissionGrant,
  AuditCache,
} from './context/AuditCache.js';

// --- Event log ---
export { EventBaselineStore } from './events/EventBaselineStore.js';
export type {
  EventLogQueryOptions,
  EventLogInterval,
  EventLogWindow,
} from './events/eventLogQuery.js';
export {
  sanitizeTypes,
  toLogDate,
  toLogHour,
  buildEventLogQuery,
  HOURLY_FORENSIC_CORE,
} from './events/eventLogQuery.js';
export type {
  EventLogFileRow,
  PulledLog,
  EventsPullResult,
  PullDeps,
  PullOptions,
} from './events/pullEventLogs.js';
export { pullEventLogs, MAX_FILE_BYTES } from './events/pullEventLogs.js';
export { classifyEventLogAccessError } from './events/eventLogAccess.js';

// --- Real-Time Event Monitoring ---
export type { RteType } from './events/rteCatalog.js';
export { RTE_CATALOG } from './events/rteCatalog.js';
export type {
  RealtimePullDeps,
  RealtimePullOptions,
  RealtimePullResult,
} from './events/pullRealtimeEvents.js';
export {
  pullRealtimeEvents,
  MAX_RTE_ROWS,
  buildRealtimeQuery,
  describeFields,
  classifyRteError,
} from './events/pullRealtimeEvents.js';

// --- Capture coverage ---
export type {
  SkipReason,
  CaptureCoverage,
  CapturedElfFile,
  SkippedElfFile,
  CapturedRteObject,
  UnavailableRteObject,
} from './events/CaptureManifest.js';
export {
  SKIP_REASONS,
  isSkipReason,
  emptyCoverage,
  readCoverageManifest,
} from './events/CaptureManifest.js';

// --- Report shell ---
export type { Branding, BrandingOverrides } from './report/branding.js';
export { DEFAULT_BRANDING, resolveBranding } from './report/branding.js';
export { fontFaceCss, firaFontFaceCss } from './report/fonts.js';
export { esc } from './renderers/html-utils.js';

// --- Findings (generic) ---
export type { RiskLevel } from './findings/RiskLevel.js';
export { RISK_LEVELS } from './findings/RiskLevel.js';

// --- Platform behaviour (API routing, Id validation, repositories) ---
export * from './platform/index.js';

// --- IR schemas (typed contracts + JSON schema access) ---
export * from './schemas/index.js';
