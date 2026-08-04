// src/events/pullEventLogs.ts
// Orchestrates a single `audit events pull` run: discover the org's EventLogFile rows for the
// requested interval and window, download the CSV body of any not already on disk, optionally
// capture Real-Time Event rows alongside them, and record a per-run coverage manifest.
// All org I/O is behind the injected SoqlClient/RestClient, so this is unit-testable with
// mocked clients — it never touches a real org.
import * as fs from 'node:fs';
import type { SoqlClient } from '../api/SoqlClient.js';
import type { RestClient } from '../api/RestClient.js';
import type { EventLogAccess } from '../context/AuditCache.js';
import { classifyEventLogAccessError } from './eventLogAccess.js';
import type { EventBaselineStore } from './EventBaselineStore.js';
import {
  HOURLY_FORENSIC_CORE,
  buildEventLogQuery,
  toLogDate,
  toLogHour,
  type EventLogInterval,
  type EventLogWindow,
} from './eventLogQuery.js';
import { emptyCoverage, type CaptureCoverage } from './CaptureManifest.js';
import { pullRealtimeEvents } from './pullRealtimeEvents.js';
import type { RteType } from './rteCatalog.js';

/**
 * Ceiling on a single LogFile body. Checked against LogFileLength *before* the download so an
 * oversized blob costs nothing, and surfaced as `too-large` in the manifest — never as a
 * silent truncation. Generous by design: this is a runaway guard, not a capture policy. A
 * busy org's daily Sites/URI log legitimately reaches tens of MB.
 */
export const MAX_FILE_BYTES = 512 * 1024 * 1024;

/** The subset of EventLogFile fields the discovery query returns. */
export interface EventLogFileRow {
  Id: string;
  EventType: string;
  LogDate: string;
  LogFileLength?: number;
  Interval?: string;
  LogFileFieldNames?: string;
}

/** Outcome for one EventLogFile row in a run. */
export interface PulledLog {
  id: string;
  eventType: string;
  logDate: string;
  /** Zero-padded UTC hour; present only for an Hourly row. */
  hour?: string;
  interval: 'Daily' | 'Hourly';
  bytes: number;
  savedPath: string;
  status: 'downloaded' | 'skipped' | 'failed';
}

/** Structured result of a pull run — returned by the command. */
export interface EventsPullResult {
  orgId: string;
  since?: number;
  window?: EventLogWindow;
  interval: EventLogInterval;
  storagePath: string;
  found: number;
  downloaded: number;
  skipped: number;
  failed: number;
  totalBytes: number;
  logs: PulledLog[];
  /** Always written — a run that captured nothing is exactly the run whose record matters. */
  manifestPath: string;
  coverage: CaptureCoverage;
  /** Set when the EventLogFile query itself failed (no crash); tells license vs permission apart. */
  accessError?: EventLogAccess;
}

export interface PullDeps {
  soql: SoqlClient;
  rest: RestClient;
  store: EventBaselineStore;
  orgId: string;
}

export interface PullOptions {
  /** Days of LogDate to request. Mutually exclusive with `window`. */
  since?: number;
  /** Explicit ISO8601 bounds. Mutually exclusive with `since`. */
  window?: EventLogWindow;
  /** Defaults to 'Daily' — the free-tier behaviour, unchanged. */
  interval?: EventLogInterval;
  /**
   * EventType allow-list. When omitted, daily capture takes every type the org offers and
   * hourly capture falls back to HOURLY_FORENSIC_CORE; an explicit list overrides both.
   */
  types?: string[];
  /** Also capture Real-Time Event Monitoring rows. Requires `window`. */
  realtime?: boolean;
  /** Restrict the RTE probe to these catalog entries. */
  rteCatalog?: readonly RteType[];
  /** Re-download / re-capture even when the target is already on disk. */
  force?: boolean;
  /** Cap on one LogFile body. Defaults to MAX_FILE_BYTES. */
  maxFileBytes?: number;
  /** Optional sink for non-fatal warnings (per-file download failures). */
  warn?: (msg: string) => void;
}

export async function pullEventLogs(deps: PullDeps, opts: PullOptions): Promise<EventsPullResult> {
  const { soql, rest, store, orgId } = deps;
  const interval = opts.interval ?? 'Daily';
  const maxFileBytes = opts.maxFileBytes ?? MAX_FILE_BYTES;
  const coverage = emptyCoverage(orgId, interval, new Date().toISOString());
  if (opts.window) coverage.window = opts.window;
  if (opts.since !== undefined) coverage.since = opts.since;

  const base: EventsPullResult = {
    orgId,
    since: opts.since,
    window: opts.window,
    interval,
    storagePath: store.orgDir(orgId),
    found: 0,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    totalBytes: 0,
    logs: [],
    manifestPath: '',
    coverage,
  };

  // 'both' cannot be a single query: daily takes every type while hourly defaults to the
  // forensic core, and one SOQL statement cannot carry two different EventType filters. Two
  // passes it is — which also keeps a failure in one interval from blanking the other.
  const passes: Array<{ interval: 'Daily' | 'Hourly'; types?: string[] }> =
    interval === 'both'
      ? [
          { interval: 'Daily', types: opts.types },
          { interval: 'Hourly', types: opts.types ?? [...HOURLY_FORENSIC_CORE] },
        ]
      : [
          {
            interval,
            types:
              interval === 'Hourly' ? (opts.types ?? [...HOURLY_FORENSIC_CORE]) : opts.types,
          },
        ];

  for (const pass of passes) {
    coverage.elf.requestedTypes.push(...(pass.types ?? []));

    let rows: EventLogFileRow[];
    try {
      rows = await soql.queryAll<EventLogFileRow>(
        buildEventLogQuery({
          since: opts.since,
          window: opts.window,
          interval: pass.interval,
          types: pass.types,
        }),
      );
    } catch (err) {
      // Inaccessible EventLogFile (unlicensed / no permission) must not crash the command,
      // and must not stop the other interval's pass from running.
      const reason = classifyEventLogAccessError(err);
      base.accessError ??= reason;
      coverage.accessErrors.push({
        scope: `EventLogFile:${pass.interval}`,
        reason,
        detail: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    base.found += rows.length;
    for (const row of rows) {
      await captureRow(deps, opts, base, coverage, row, pass.interval, maxFileBytes);
    }
  }

  // RTE capture is independent of ELF by design: a broken probe on either side must never
  // prevent the other from running.
  if (opts.realtime) {
    if (!opts.window) {
      coverage.accessErrors.push({
        scope: 'RealtimeEvents',
        reason: 'unknown',
        detail: 'realtime capture requires an explicit window',
      });
    } else {
      try {
        const rte = await pullRealtimeEvents(
          { soql, rest, store, orgId },
          {
            window: opts.window,
            catalog: opts.rteCatalog,
            force: opts.force,
            warn: opts.warn,
          },
        );
        coverage.rte = rte;
      } catch (err) {
        coverage.accessErrors.push({
          scope: 'RealtimeEvents',
          reason: 'unknown',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Always written. A run that captured nothing is exactly the run a consumer needs a record
  // of — without it, "no data" and "never looked" are indistinguishable.
  base.manifestPath = store.writeCoverageManifest(orgId, coverage);
  return base;
}

/** Download (or account for skipping) one EventLogFile row. Never throws. */
async function captureRow(
  deps: PullDeps,
  opts: PullOptions,
  base: EventsPullResult,
  coverage: CaptureCoverage,
  row: EventLogFileRow,
  passInterval: 'Daily' | 'Hourly',
  maxFileBytes: number,
): Promise<void> {
  const { rest, store, orgId } = deps;
  const logDate = toLogDate(row.LogDate);
  // Trust the row's own Interval over the pass it arrived on: with interval 'both' the query
  // carries no Interval predicate, so a pass can return either kind.
  const rowInterval = row.Interval === 'Hourly' || row.Interval === 'Daily' ? row.Interval : passInterval;
  const hour = rowInterval === 'Hourly' ? toLogHour(row.LogDate) : undefined;
  const savedPath = store.pathFor(orgId, row.EventType, logDate, row.Id, hour);

  const record = (status: PulledLog['status'], bytes: number): void => {
    base.logs.push({
      id: row.Id,
      eventType: row.EventType,
      logDate,
      hour,
      interval: rowInterval,
      bytes,
      savedPath,
      status,
    });
  };

  if (!opts.force && store.has(orgId, row.EventType, logDate, row.Id, hour)) {
    base.skipped += 1;
    record('skipped', 0);
    coverage.elf.skipped.push({
      type: row.EventType,
      id: row.Id,
      logDate,
      hour,
      reason: 'already-captured',
    });
    return;
  }

  if (typeof row.LogFileLength === 'number' && row.LogFileLength > maxFileBytes) {
    base.skipped += 1;
    record('skipped', 0);
    coverage.elf.skipped.push({
      type: row.EventType,
      id: row.Id,
      logDate,
      hour,
      reason: 'too-large',
      detail: `${row.LogFileLength} bytes exceeds the ${maxFileBytes}-byte cap`,
    });
    opts.warn?.(
      `Skipped EventLogFile ${row.Id} (${row.EventType} ${logDate}): ${row.LogFileLength} bytes exceeds the cap`,
    );
    return;
  }

  try {
    // Stream straight to disk — never buffer the body — so large logs don't blow the heap.
    //
    // Staged through a temp file and renamed, so the final path only ever exists complete.
    // The client already removes a partial file when the stream errors, but that cannot help
    // if the process itself dies mid-download: the truncated CSV would satisfy `has()` and be
    // skipped by every later run, leaving a silently incomplete log presented as a whole one.
    const tmpPath = `${savedPath}.${process.pid}.part`;
    const bytes = await rest.getRawToFile(`/sobjects/EventLogFile/${row.Id}/LogFile`, tmpPath);
    fs.renameSync(tmpPath, savedPath);
    base.downloaded += 1;
    base.totalBytes += bytes;
    record('downloaded', bytes);
    coverage.elf.captured.push({
      type: row.EventType,
      id: row.Id,
      logDate,
      hour,
      bytes,
      path: savedPath,
    });
  } catch (err) {
    fs.rmSync(`${savedPath}.${process.pid}.part`, { force: true });
    base.failed += 1;
    record('failed', 0);
    coverage.elf.failed.push({
      type: row.EventType,
      id: row.Id,
      logDate,
      hour,
      reason: 'download-failed',
      detail: err instanceof Error ? err.message : String(err),
    });
    opts.warn?.(
      `Failed to download EventLogFile ${row.Id} (${row.EventType} ${logDate}): ${String(err)}`,
    );
  }
}
