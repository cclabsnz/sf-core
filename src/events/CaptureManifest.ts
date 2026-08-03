// src/events/CaptureManifest.ts
// The per-pull coverage record. Its whole reason to exist is letting a downstream consumer
// tell *nothing happened* from *nothing was captured* — an empty result set is only evidence
// of absence if you know the capture was actually possible and actually ran.
//
// That is why `reason` is a closed enum rather than free text: a consumer branches on it, and
// "unlicensed" vs "storage-disabled" vs "no-permission" are three different answers to
// "should I trust this silence?" with three different remediations.
import * as fs from 'node:fs';

/** Why something present in the request is absent from the capture. Closed set — consumers branch on it. */
export type SkipReason =
  | 'not-in-core-set'
  | 'already-captured'
  | 'download-failed'
  | 'too-large'
  | 'unlicensed'
  | 'storage-disabled'
  | 'no-permission'
  | 'not-queryable'
  | 'unknown';

export const SKIP_REASONS: readonly SkipReason[] = [
  'not-in-core-set',
  'already-captured',
  'download-failed',
  'too-large',
  'unlicensed',
  'storage-disabled',
  'no-permission',
  'not-queryable',
  'unknown',
];

export function isSkipReason(value: unknown): value is SkipReason {
  return typeof value === 'string' && (SKIP_REASONS as readonly string[]).includes(value);
}

export interface CapturedElfFile {
  type: string;
  id: string;
  logDate: string;
  /** Absent for a daily file. */
  hour?: string;
  bytes: number;
  path: string;
}

export interface SkippedElfFile {
  type: string;
  id?: string;
  logDate?: string;
  hour?: string;
  reason: SkipReason;
  detail?: string;
}

export interface CapturedRteObject {
  object: string;
  rows: number;
  /** Which name actually answered — the base object or its retained-rows Store counterpart. */
  via: 'base' | 'store';
  paths: string[];
}

export interface UnavailableRteObject {
  object: string;
  reason: SkipReason;
  detail?: string;
}

export interface CaptureCoverage {
  orgId: string;
  capturedAt: string;
  window?: { from: string; to: string };
  since?: number;
  interval: 'Daily' | 'Hourly' | 'both';
  elf: {
    requestedTypes: string[];
    captured: CapturedElfFile[];
    skipped: SkippedElfFile[];
    failed: SkippedElfFile[];
  };
  rte: {
    captured: CapturedRteObject[];
    unavailable: UnavailableRteObject[];
  };
  /** Query-level failures — an inaccessible EventLogFile object, say. Empty is the good case. */
  accessErrors: Array<{ scope: string; reason: string; detail?: string }>;
}

/** An empty coverage record for one org, ready to be filled in as a pull proceeds. */
export function emptyCoverage(
  orgId: string,
  interval: CaptureCoverage['interval'],
  capturedAt: string,
): CaptureCoverage {
  return {
    orgId,
    capturedAt,
    interval,
    elf: { requestedTypes: [], captured: [], skipped: [], failed: [] },
    rte: { captured: [], unavailable: [] },
    accessErrors: [],
  };
}

/**
 * Read a coverage manifest back off disk. Returns undefined rather than throwing on a missing
 * or malformed file: a consumer scanning a directory of manifests should skip the bad one and
 * carry on, not abort the scan.
 */
export function readCoverageManifest(filePath: string): CaptureCoverage | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return isCoverage(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isCoverage(value: unknown): value is CaptureCoverage {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<CaptureCoverage>;
  return typeof c.orgId === 'string' && typeof c.capturedAt === 'string' && typeof c.elf === 'object';
}
