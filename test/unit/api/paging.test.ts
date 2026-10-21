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
