import { jest } from '@jest/globals';
import { collectPages, MAX_QUERY_PAGES, type QueryPage } from '../../../src/api/paging.js';

const page = (ids: string[], next?: string): QueryPage<string> => ({
  totalSize: ids.length,
  done: !next,
  records: ids,
  ...(next ? { nextRecordsUrl: next } : {}),
});

describe('collectPages', () => {
  it('concatenates three pages in order and passes each nextRecordsUrl verbatim', async () => {
    const fetchNext = jest
      .fn<(url: string) => Promise<QueryPage<string>>>()
      .mockResolvedValueOnce(page(['c', 'd'], '/q/02'))
      .mockResolvedValueOnce(page(['e']));
    const out = await collectPages(page(['a', 'b'], '/q/01'), fetchNext);
    expect(out).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(fetchNext.mock.calls).toEqual([['/q/01'], ['/q/02']]);
  });

  it('makes no fetchNext call for a single done page', async () => {
    const fetchNext = jest.fn<(url: string) => Promise<QueryPage<string>>>();
    expect(await collectPages(page(['a']), fetchNext)).toEqual(['a']);
    expect(fetchNext).not.toHaveBeenCalled();
  });

  it('rejects with QUERY_TOO_LARGE when page 201 would be needed', async () => {
    const fetchNext = jest.fn(async (_url: string) => page(['x'], '/q/more'));
    const err = await collectPages(page(['x'], '/q/more'), fetchNext).catch((e: unknown) => e);
    expect((err as any).errorCode).toBe('QUERY_TOO_LARGE');
    expect(fetchNext).toHaveBeenCalledTimes(MAX_QUERY_PAGES - 1);
  });

  it('accepts exactly MAX_QUERY_PAGES pages', async () => {
    let n = 1;
    const fetchNext = jest.fn(async (_url: string) => {
      n++;
      return page(['x'], n < MAX_QUERY_PAGES ? '/q/more' : undefined);
    });
    const out = await collectPages(page(['x'], '/q/more'), fetchNext);
    expect(out).toHaveLength(MAX_QUERY_PAGES);
  });
});

describe('collectPages with child relationship pages', () => {
  type Parent = { Id: string; Contacts: QueryPage<{ Id: string }> | null };
  const child = (ids: string[], next?: string): QueryPage<{ Id: string }> => ({
    totalSize: 3,
    done: !next,
    records: ids.map((Id) => ({ Id })),
    ...(next ? { nextRecordsUrl: next } : {}),
  });

  it('follows a two-page child relationship and leaves the shape jsforce leaves', async () => {
    const first: QueryPage<Parent> = {
      totalSize: 2,
      done: true,
      records: [
        { Id: 'p1', Contacts: child(['c1', 'c2'], '/q/child-01') },
        { Id: 'p2', Contacts: null },
      ],
    };
    const fetchNext = jest.fn(async (_url: string) => child(['c3']) as unknown as QueryPage<Parent>);
    const out = await collectPages<Parent>(first, fetchNext);
    expect(fetchNext.mock.calls).toEqual([['/q/child-01']]);
    // jsforce (query.js): { ...field, records: <all>, done: true, nextRecordsUrl: undefined }.
    expect(out[0].Contacts).toStrictEqual({
      totalSize: 3,
      done: true,
      records: [{ Id: 'c1' }, { Id: 'c2' }, { Id: 'c3' }],
      nextRecordsUrl: undefined,
    });
    expect(out[1]).toEqual({ Id: 'p2', Contacts: null });
  });

  it('expands child pages on every parent page, in order, before the next parent page', async () => {
    const first: QueryPage<Parent> = {
      totalSize: 2, done: false, nextRecordsUrl: '/q/parent-02',
      records: [{ Id: 'p1', Contacts: child(['c1'], '/q/c-p1') }],
    };
    const replies: Record<string, unknown> = {
      '/q/c-p1': child(['c2']),
      '/q/parent-02': { totalSize: 2, done: true, records: [{ Id: 'p2', Contacts: child(['d1'], '/q/c-p2') }] },
      '/q/c-p2': child(['d2']),
    };
    const fetchNext = jest.fn(async (url: string) => replies[url] as QueryPage<Parent>);
    const out = await collectPages<Parent>(first, fetchNext);
    expect(fetchNext.mock.calls.map((c) => c[0])).toEqual(['/q/c-p1', '/q/parent-02', '/q/c-p2']);
    expect(out.map((p) => p.Contacts?.records.map((c) => c.Id))).toEqual([['c1', 'c2'], ['d1', 'd2']]);
  });

  it('counts child pages toward the page cap', async () => {
    const first: QueryPage<Parent> = {
      totalSize: 1, done: true, records: [{ Id: 'p1', Contacts: child(['c'], '/q/more') }],
    };
    const fetchNext = jest.fn(async (_url: string) => child(['c'], '/q/more') as unknown as QueryPage<Parent>);
    const err = await collectPages<Parent>(first, fetchNext).catch((e: unknown) => e);
    expect((err as any).errorCode).toBe('QUERY_TOO_LARGE');
    expect(fetchNext).toHaveBeenCalledTimes(MAX_QUERY_PAGES - 1);
  });
});
