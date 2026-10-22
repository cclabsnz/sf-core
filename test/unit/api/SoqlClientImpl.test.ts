import { jest } from '@jest/globals';
import { isApiError } from '../../../src/api/ApiError.js';
import { SoqlClientImpl } from '../../../src/api/SoqlClientImpl.js';
import { jsforceError } from './helpers/jsforce.js';

describe('SoqlClientImpl', () => {
  let fakeConn: any;
  let client: SoqlClientImpl;

  beforeEach(() => {
    fakeConn = {
      query: jest.fn(),
      autoFetchQuery: jest.fn(() => {
        throw new Error('autoFetchQuery must not be called');
      }),
      request: jest.fn(),
    };
    client = new SoqlClientImpl(fakeConn);
  });

  describe('query()', () => {
    it('returns totalSize, done, and records from Connection.query', async () => {
      fakeConn.query.mockResolvedValue({
        totalSize: 2,
        done: true,
        records: [{ Id: '001' }, { Id: '002' }],
      });

      const result = await client.query<{ Id: string }>('SELECT Id FROM Account');

      expect(result.totalSize).toBe(2);
      expect(result.done).toBe(true);
      expect(result.records).toHaveLength(2);
      expect(fakeConn.query).toHaveBeenCalledWith('SELECT Id FROM Account');
    });

    it('returns empty records array when Connection returns undefined records', async () => {
      fakeConn.query.mockResolvedValue({ totalSize: 0, done: true, records: undefined });
      const result = await client.query('SELECT Id FROM Account');
      expect(result.records).toEqual([]);
    });
  });

  describe('queryAll()', () => {
    it('returns records from a single done page', async () => {
      fakeConn.query.mockResolvedValue({
        totalSize: 3,
        done: true,
        records: [{ Id: 'a' }, { Id: 'b' }, { Id: 'c' }],
      });
      const result = await client.queryAll<{ Id: string }>('SELECT Id FROM User');
      expect(result).toHaveLength(3);
      expect(fakeConn.request).not.toHaveBeenCalled();
    });

    it('returns empty array when no records', async () => {
      fakeConn.query.mockResolvedValue({ totalSize: 0, done: true, records: undefined });
      expect(await client.queryAll('SELECT Id FROM User')).toEqual([]);
    });

    it('returns all 12000 records across pages without autoFetchQuery', async () => {
      const rows = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ Id: String(from + i) }));
      fakeConn.query.mockResolvedValue({ totalSize: 12000, done: false, records: rows(2000, 0), nextRecordsUrl: '/q/01' });
      fakeConn.request
        .mockResolvedValueOnce({ totalSize: 12000, done: false, records: rows(9000, 2000), nextRecordsUrl: '/q/02' })
        .mockResolvedValueOnce({ totalSize: 12000, done: true, records: rows(1000, 11000) });
      const result = await client.queryAll<{ Id: string }>('SELECT Id FROM AuditTrail');
      expect(result).toHaveLength(12000);
      expect(result[11999].Id).toBe('11999');
      expect(fakeConn.request.mock.calls).toEqual([['/q/01'], ['/q/02']]);
      expect(fakeConn.autoFetchQuery).not.toHaveBeenCalled();
    });
  });

  it('honours a custom page cap passed to the constructor', async () => {
    const capped = new SoqlClientImpl(fakeConn, { maxPages: 2 });
    fakeConn.query.mockResolvedValue({ totalSize: 3, done: false, records: [{ Id: 'a' }], nextRecordsUrl: '/q/01' });
    fakeConn.request.mockResolvedValue({ totalSize: 3, done: false, records: [{ Id: 'b' }], nextRecordsUrl: '/q/02' });
    const err = await capped.queryAll('SELECT Id FROM User').catch((e: unknown) => e);
    expect((err as any).errorCode).toBe('QUERY_TOO_LARGE');
    expect((err as Error).message).toContain('more than 2 pages');
    expect(fakeConn.request).toHaveBeenCalledTimes(1);
  });

  it('rejects with an ApiError when the connection raises a jsforce error', async () => {
    fakeConn.query.mockRejectedValue(jsforceError());
    for (const call of [() => client.query('x'), () => client.queryAll('x')]) {
      const err = await call().catch((e: unknown) => e);
      expect(isApiError(err)).toBe(true);
      expect((err as any).errorCode).toBe('INVALID_TYPE');
    }
  });
});
