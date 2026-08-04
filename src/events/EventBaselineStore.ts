// src/events/EventBaselineStore.ts
// Local, on-disk archive of EventLogFile CSVs and Real-Time Event NDJSON. Mirrors HistoryStore:
// writes under ~/.sf/event-baseline/{orgId}/, takes an optional root for testability, and is
// best-effort (warns rather than throws) so a scheduled run never dies on a filesystem hiccup.
//
// Path layout — this is the contract downstream consumers read against:
//
//   {base}/{orgId}/
//     {EventType}/{YYYY-MM-DD}-{id}.csv          daily
//     {EventType}/{YYYY-MM-DD}/{HH}-{id}.csv     hourly
//     _realtime/{ObjectName}/{YYYY-MM-DD}/{HH}.ndjson
//     _manifests/coverage-{epochMs}-{rand}.json
//
// The daily and hourly forms cannot collide: the daily form is a *file* named
// `{date}-{id}.csv` while the hourly form nests a *directory* named `{date}`. Daily archives
// written by earlier versions therefore keep resolving with no migration.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export class EventBaselineStore {
  private readonly root: string;

  constructor(root?: string) {
    this.root = root ?? EventBaselineStore.defaultRoot();
  }

  static defaultRoot(): string {
    return path.join(os.homedir(), '.sf', 'event-baseline');
  }

  /** The per-org base directory logs for this org are stored under. */
  orgDir(orgId: string): string {
    return path.join(this.root, segment(orgId));
  }

  /**
   * Absolute path a given log file is (or would be) stored at. Pass `hour` ('00'–'23', UTC)
   * for an hourly capture; omit it and the layout is exactly what it has always been.
   *
   * `id` stays in the hourly path because a single (type, hour) can hold several files — a
   * verified case had two AuraRequest rows for the same hour.
   */
  pathFor(orgId: string, eventType: string, logDate: string, id: string, hour?: string): string {
    const [o, t, d, i] = [orgId, eventType, logDate, id].map(segment);
    return hour === undefined
      ? path.join(this.root, o, t, `${d}-${i}.csv`)
      : path.join(this.root, o, t, d, `${padHour(hour)}-${i}.csv`);
  }

  /**
   * True when this EventLogFile is already captured — the dedup / idempotency check.
   *
   * Requires a non-empty file, not merely an existing one. A zero-byte file is what a run
   * killed between create and write leaves behind, and treating that as captured would retire
   * the row permanently: every later run skips it, and the gap never appears in any manifest.
   */
  has(orgId: string, eventType: string, logDate: string, id: string, hour?: string): boolean {
    return nonEmpty(this.pathFor(orgId, eventType, logDate, id, hour));
  }

  /** Write a CSV body verbatim; returns the saved path. Best-effort. */
  save(
    orgId: string,
    eventType: string,
    logDate: string,
    id: string,
    body: string,
    hour?: string,
  ): string {
    const filePath = this.pathFor(orgId, eventType, logDate, id, hour);
    try {
      writeAtomic(filePath, body);
    } catch (err) {
      process.stderr.write(`[sf-audit] Warning: could not save event log ${id}: ${String(err)}\n`);
    }
    return filePath;
  }

  /** Absolute path the NDJSON for one Real-Time Event object-hour is (or would be) stored at. */
  realtimePathFor(orgId: string, objectName: string, logDate: string, hour: string): string {
    const [o, n, d] = [orgId, objectName, logDate].map(segment);
    return path.join(this.root, o, '_realtime', n, d, `${padHour(hour)}.ndjson`);
  }

  /** True when this object-hour already holds a complete NDJSON file. */
  hasRealtime(orgId: string, objectName: string, logDate: string, hour: string): boolean {
    return nonEmpty(this.realtimePathFor(orgId, objectName, logDate, hour));
  }

  /**
   * Write RTE rows as NDJSON — one JSON object per line, so the file stays parseable line by
   * line and a reader never has to hold the whole set in memory.
   *
   * Written to a temporary file and renamed into place. The earlier rationale — that a
   * half-written NDJSON is still parseable up to the last complete line — is true but beside
   * the point: `hasRealtime` cannot distinguish a truncated file from a complete one, so a
   * partial write would be skipped by every later run and silently pass as full coverage.
   * Rename is atomic within a filesystem, so the file is either absent or whole.
   */
  saveRealtime(
    orgId: string,
    objectName: string,
    logDate: string,
    hour: string,
    rows: readonly unknown[],
  ): string {
    const filePath = this.realtimePathFor(orgId, objectName, logDate, hour);
    try {
      writeAtomic(filePath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    } catch (err) {
      process.stderr.write(
        `[sf-audit] Warning: could not save realtime events ${objectName} ${logDate} ${hour}: ${String(err)}\n`,
      );
    }
    return filePath;
  }

  /**
   * Write a per-run coverage manifest under {root}/{orgId}/_manifests/. Named `coverage-*` to
   * keep it distinguishable from the legacy `manifest-*` files a consumer may still find in
   * the same directory.
   */
  writeCoverageManifest(orgId: string, manifest: unknown): string {
    return this.writeManifestAs(orgId, 'coverage', manifest);
  }

  /**
   * @deprecated Superseded by {@link writeCoverageManifest}, which records why nothing was
   * captured as well as what was. Retained so existing readers of `manifest-*.json` keep working.
   */
  writeManifest(orgId: string, manifest: unknown): string {
    return this.writeManifestAs(orgId, 'manifest', manifest);
  }

  private writeManifestAs(orgId: string, prefix: string, manifest: unknown): string {
    const dir = path.join(this.root, segment(orgId), '_manifests');
    const suffix = Math.random().toString(36).slice(2, 8);
    const filePath = path.join(dir, `${prefix}-${Date.now()}-${suffix}.json`);
    try {
      // Atomic for the same reason as the captures: a reader scanning _manifests must never
      // parse a half-written coverage record and conclude the run captured less than it did.
      writeAtomic(filePath, JSON.stringify(manifest, null, 2));
    } catch (err) {
      process.stderr.write(`[sf-audit] Warning: could not write event manifest: ${String(err)}\n`);
    }
    return filePath;
  }
}

/** Hours are stored zero-padded so lexical order matches chronological order. */
function padHour(hour: string | number): string {
  return String(segment(String(hour))).padStart(2, '0');
}

/**
 * Constrain one org-supplied value to a single safe path segment.
 *
 * EventType, RTE object names, org ids and file ids all arrive from query results and are
 * joined straight into a filesystem path. They are Salesforce identifiers in practice, but
 * "in practice" is not a boundary: a value of `../../..` would place captured evidence
 * outside the store, and this package writes to a directory under the operator's home. So
 * anything that is not an identifier character is folded to `_`, and a segment that reduces
 * to nothing (or to dots) becomes `_` rather than silently resolving to a parent directory.
 */
function segment(raw: string): string {
  const cleaned = String(raw).replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned.length === 0 || /^\.+$/.test(cleaned) ? '_' : cleaned;
}

/** True when the path holds a file with at least one byte. */
function nonEmpty(filePath: string): boolean {
  try {
    return fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

/**
 * Write via a temporary file and rename into place, so a reader never observes a partial
 * file. The temp name carries the pid so two concurrent pulls of the same org — a cron run
 * overlapping a manual one — cannot corrupt each other's staging file.
 */
function writeAtomic(filePath: string, body: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, body, 'utf-8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
