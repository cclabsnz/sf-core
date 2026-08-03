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
    return path.join(this.root, orgId);
  }

  /**
   * Absolute path a given log file is (or would be) stored at. Pass `hour` ('00'–'23', UTC)
   * for an hourly capture; omit it and the layout is exactly what it has always been.
   *
   * `id` stays in the hourly path because a single (type, hour) can hold several files — a
   * verified case had two AuraRequest rows for the same hour.
   */
  pathFor(orgId: string, eventType: string, logDate: string, id: string, hour?: string): string {
    return hour === undefined
      ? path.join(this.root, orgId, eventType, `${logDate}-${id}.csv`)
      : path.join(this.root, orgId, eventType, logDate, `${padHour(hour)}-${id}.csv`);
  }

  /** True when this EventLogFile is already on disk — the dedup / idempotency check. */
  has(orgId: string, eventType: string, logDate: string, id: string, hour?: string): boolean {
    return fs.existsSync(this.pathFor(orgId, eventType, logDate, id, hour));
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
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, body, 'utf-8');
    } catch (err) {
      process.stderr.write(`[sf-audit] Warning: could not save event log ${id}: ${String(err)}\n`);
    }
    return filePath;
  }

  /** Absolute path the NDJSON for one Real-Time Event object-hour is (or would be) stored at. */
  realtimePathFor(orgId: string, objectName: string, logDate: string, hour: string): string {
    return path.join(this.root, orgId, '_realtime', objectName, logDate, `${padHour(hour)}.ndjson`);
  }

  /** True when this object-hour already holds a non-empty NDJSON file. */
  hasRealtime(orgId: string, objectName: string, logDate: string, hour: string): boolean {
    const filePath = this.realtimePathFor(orgId, objectName, logDate, hour);
    try {
      return fs.statSync(filePath).size > 0;
    } catch {
      return false;
    }
  }

  /**
   * Write RTE rows as NDJSON — one JSON object per line, so a run killed mid-write still
   * leaves a parseable file up to the last complete line. Same failure-tolerance rationale as
   * streaming raw CSV bytes to disk before parsing them.
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
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
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
    const dir = path.join(this.root, orgId, '_manifests');
    const suffix = Math.random().toString(36).slice(2, 8);
    const filePath = path.join(dir, `${prefix}-${Date.now()}-${suffix}.json`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), 'utf-8');
    } catch (err) {
      process.stderr.write(`[sf-audit] Warning: could not write event manifest: ${String(err)}\n`);
    }
    return filePath;
  }
}

/** Hours are stored zero-padded so lexical order matches chronological order. */
function padHour(hour: string | number): string {
  return String(hour).padStart(2, '0');
}
