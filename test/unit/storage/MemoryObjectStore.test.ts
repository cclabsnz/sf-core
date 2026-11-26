import { describe, expect, it } from '@jest/globals';
import { MemoryObjectStore } from '../../../src/storage/testing/MemoryObjectStore.js';
import { BucketMissingError } from '../../../src/storage/errors.js';

const b = (s: string) => Buffer.from(s);

describe('MemoryObjectStore', () => {
  it('round-trips and returns null for a missing key', async () => {
    const s = new MemoryObjectStore();
    expect(await s.get('k')).toBeNull();
    await s.put('k', b('v'), 'text/plain');
    expect(await s.get('k')).toEqual(b('v'));
    expect(s.objects.get('k')).toEqual(b('v'));
  });

  it('pages list by pageSize with a working next token', async () => {
    const s = new MemoryObjectStore({ pageSize: 2 });
    for (const k of ['p/a', 'p/b', 'p/c', 'p/d', 'p/e', 'q/z']) await s.put(k, b(k), 'x');
    const seen: string[] = [];
    let token: string | undefined;
    let pages = 0;
    do {
      const r = await s.list({ prefix: 'p/', token });
      seen.push(...r.keys.map((k) => k.key));
      expect(r.keys.length).toBeLessThanOrEqual(2);
      token = r.next;
      pages++;
    } while (token);
    expect(seen).toEqual(['p/a', 'p/b', 'p/c', 'p/d', 'p/e']);
    expect(pages).toBe(3);
  });

  it('reports sizes and honours maxKeys', async () => {
    const s = new MemoryObjectStore();
    await s.put('a', b('123'), 'x');
    await s.put('b', b('1'), 'x');
    const r = await s.list({ prefix: '', maxKeys: 1 });
    expect(r.keys).toEqual([{ key: 'a', size: 3 }]);
    expect(r.next).toBeDefined();
  });

  it("delimiter '/' returns common prefixes", async () => {
    const s = new MemoryObjectStore();
    for (const k of ['r/a/1', 'r/a/2', 'r/b/1', 'r/top']) await s.put(k, b('x'), 'x');
    const r = await s.list({ prefix: 'r/', delimiter: '/' });
    expect(r.prefixes).toEqual(['r/a/', 'r/b/']);
    expect(r.keys.map((k) => k.key)).toEqual(['r/top']);
  });

  it('does not repeat a common prefix across pages', async () => {
    const s = new MemoryObjectStore({ pageSize: 1 });
    for (const k of ['r/a/1', 'r/a/2', 'r/b/1']) await s.put(k, b('x'), 'x');
    const seen: string[] = [];
    let token: string | undefined;
    do {
      const r = await s.list({ prefix: 'r/', delimiter: '/', token });
      seen.push(...r.prefixes);
      token = r.next;
    } while (token);
    expect(seen).toEqual(['r/a/', 'r/b/']);
  });

  it('two concurrent putIfAbsent on one key yield exactly one true', async () => {
    const s = new MemoryObjectStore();
    const results = await Promise.all([s.putIfAbsent('k', b('1'), 'x'), s.putIfAbsent('k', b('2'), 'x')]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await s.get('k')).toEqual(b('1'));
  });

  it('bucketExists:false makes every method throw BucketMissingError', async () => {
    const s = new MemoryObjectStore({ bucketExists: false });
    await expect(s.get('k')).rejects.toBeInstanceOf(BucketMissingError);
    await expect(s.put('k', b('x'), 'x')).rejects.toBeInstanceOf(BucketMissingError);
    await expect(s.putIfAbsent('k', b('x'), 'x')).rejects.toBeInstanceOf(BucketMissingError);
    await expect(s.list({ prefix: '' })).rejects.toBeInstanceOf(BucketMissingError);
  });

  it('failNextPut fails once then clears', async () => {
    const s = new MemoryObjectStore();
    const boom = new Error('boom');
    s.failNextPut = () => boom;
    await expect(s.put('k', b('x'), 'x')).rejects.toBe(boom);
    expect(s.failNextPut).toBeUndefined();
    await s.put('k', b('x'), 'x');
    expect(s.objects.has('k')).toBe(true);
    s.failNextPut = () => boom;
    await expect(s.putIfAbsent('k2', b('x'), 'x')).rejects.toBe(boom);
  });
});
