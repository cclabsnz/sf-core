/**
 * A minimal object-store connection: whole-object reads and writes by full key, one page of
 * listing at a time. Prefixes are the caller's business; the store never adds one.
 */
export interface ObjectStore {
  /** The object's bytes, or null when no such key exists. */
  get(key: string): Promise<Buffer | null>;
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Create-only (If-None-Match: *). false when the key already exists (HTTP 412). */
  putIfAbsent(key: string, bytes: Buffer, contentType: string): Promise<boolean>;
  /** One page. `delimiter: '/'` fills `prefixes`. */
  list(args: { prefix: string; delimiter?: string; maxKeys?: number; token?: string }): Promise<{
    keys: Array<{ key: string; size: number }>;
    prefixes: string[];
    next?: string;
  }>;
}
