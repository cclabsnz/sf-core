import { jest } from '@jest/globals';
import { isApiError } from '../../../src/api/ApiError.js';
import { SoqlClientImpl } from '../../../src/api/SoqlClientImpl.js';

describe('SoqlClientImpl', () => {
  let fakeConn: any;
  let client: SoqlClientImpl;

  beforeEach(() => {
    fakeConn = {
      query: jest.fn(),
      autoFetchQuery: jest.fn(),
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
    it('returns flattened records from Connection.autoFetchQuery', async () => {
      fakeConn.autoFetchQuery.mockResolvedValue({
        totalSize: 3,
        done: true,
        records: [{ Id: 'a' }, { Id: 'b' }, { Id: 'c' }],
      });

      const result = await client.queryAll<{ Id: string }>('SELECT Id FROM User');

      expect(result).toHaveLength(3);
      expect(result[0].Id).toBe('a');
    });

    it('returns empty array when no records', async () => {
      fakeConn.autoFetchQuery.mockResolvedValue({ totalSize: 0, done: true, records: undefined });
      const result = await client.queryAll('SELECT Id FROM User');
      expect(result).toEqual([]);
    });
  });

  it('rejects with an ApiError when the connection raises a jsforce error', async () => {
    fakeConn.query.mockRejectedValue(Object.assign(new Error('sObject type x'), { name: 'INVALID_TYPE', errorCode: 'INVALID_TYPE', data: { errorCode: 'INVALID_TYPE' } }));
    fakeConn.autoFetchQuery.mockRejectedValue(Object.assign(new Error('sObject type x'), { name: 'INVALID_TYPE', errorCode: 'INVALID_TYPE', data: { errorCode: 'INVALID_TYPE' } }));
    for (const call of [() => client.query('x'), () => client.queryAll('x')]) {
      const err = await call().catch((e: unknown) => e);
      expect(isApiError(err)).toBe(true);
      expect((err as any).errorCode).toBe('INVALID_TYPE');
    }
  });
});
