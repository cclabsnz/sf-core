import type { ObjectStore } from '../ObjectStore.js';
import { BucketMissingError } from '../errors.js';

/** In-memory ObjectStore for tests. Keys list in lexical order; the token is the last key returned. */
export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, Buffer>();
  /** Return an Error to make the next put/putIfAbsent of that key fail with it. */
  failNextPut?: (key: string) => Error | undefined;

  private readonly pageSize: number;
  private readonly bucketExists: boolean;

  constructor(opts: { pageSize?: number; bucketExists?: boolean } = {}) {
    this.pageSize = opts.pageSize ?? 1000;
    this.bucketExists = opts.bucketExists ?? true;
  }

  private check(): void {
    if (!this.bucketExists) throw new BucketMissingError('memory');
  }

  private maybeFail(key: string): void {
    const err = this.failNextPut?.(key);
    if (err) {
      this.failNextPut = undefined;
      throw err;
    }
  }

  async get(key: string): Promise<Buffer | null> {
    this.check();
    return this.objects.get(key) ?? null;
  }

  async put(key: string, bytes: Buffer, _contentType: string): Promise<void> {
    this.check();
    this.maybeFail(key);
    this.objects.set(key, Buffer.from(bytes));
  }

  async putIfAbsent(key: string, bytes: Buffer, _contentType: string): Promise<boolean> {
    this.check();
    this.maybeFail(key);
    // No await between the check and the set, so concurrent callers cannot both win.
    if (this.objects.has(key)) return false;
    this.objects.set(key, Buffer.from(bytes));
    return true;
  }

  async list(args: { prefix: string; delimiter?: string; maxKeys?: number; token?: string }): Promise<{
    keys: Array<{ key: string; size: number }>;
    prefixes: string[];
    next?: string;
  }> {
    this.check();
    const limit = Math.min(args.maxKeys ?? this.pageSize, this.pageSize);
    const keys: Array<{ key: string; size: number }> = [];
    const prefixes: string[] = [];
    let count = 0;
    let last: string | undefined;
    let more = false;
    for (const key of [...this.objects.keys()].filter((k) => k.startsWith(args.prefix)).sort()) {
      if (args.token !== undefined && key <= args.token) continue;
      let common: string | undefined;
      if (args.delimiter) {
        const i = key.indexOf(args.delimiter, args.prefix.length);
        if (i !== -1) common = key.slice(0, i + args.delimiter.length);
      }
      // Further keys under an already-listed common prefix add nothing to the page.
      if (common !== undefined && prefixes.includes(common)) {
        continue;
      }
      if (count >= limit) {
        more = true;
        break;
      }
      if (common !== undefined) prefixes.push(common);
      else keys.push({ key, size: this.objects.get(key)!.length });
      count++;
      // A token ending on a common prefix must skip the rest of that prefix on the next page.
      last = common !== undefined ? common + '\uffff' : key;
    }
    return { keys, prefixes, next: more ? last : undefined };
  }
}
