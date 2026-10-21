import { jest } from '@jest/globals';
import { isApiError } from '../../../src/api/ApiError.js';
import { ToolingClientImpl } from '../../../src/api/ToolingClientImpl.js';

describe('ToolingClientImpl', () => {
  let fakeConn: any;
  let client: ToolingClientImpl;

  beforeEach(() => {
    fakeConn = {
      tooling: {
        query: jest.fn(),
        // Note: conn.tooling has no queryMore — pagination uses conn.request() directly
      },
      request: jest.fn(),
      getApiVersion: jest.fn().mockReturnValue('67.0'),
    };
    client = new ToolingClientImpl(fakeConn);
  });

  describe('query()', () => {
    it('returns records from a single page', async () => {
      fakeConn.tooling.query.mockResolvedValue({
        totalSize: 2,
        done: true,
        records: [{ Id: '001' }, { Id: '002' }],
        nextRecordsUrl: undefined,
      });

      const result = await client.query<{ Id: string }>('SELECT Id FROM ApexClass');

      expect(result).toHaveLength(2);
      expect(fakeConn.request).not.toHaveBeenCalled();
    });

    it('follows pagination via nextRecordsUrl using conn.request()', async () => {
      fakeConn.tooling.query.mockResolvedValue({
        done: false,
        records: [{ Id: '001' }],
        nextRecordsUrl: '/services/data/v67.0/tooling/query/01g-next',
      });
      // Second page comes via conn.request() (not tooling.queryMore — that doesn't exist)
      fakeConn.request.mockResolvedValueOnce({
        done: true,
        records: [{ Id: '002' }],
        nextRecordsUrl: undefined,
      });

      const result = await client.query<{ Id: string }>('SELECT Id FROM ApexClass');

      expect(result).toHaveLength(2);
      expect(fakeConn.request).toHaveBeenCalledWith('/services/data/v67.0/tooling/query/01g-next');
    });
  });

  it('rejects QUERY_TOO_LARGE rather than returning a truncated result at 201 pages', async () => {
    const next = '/services/data/v67.0/tooling/query/01g-next';
    fakeConn.tooling.query.mockResolvedValue({ done: false, records: [{ Id: 'x' }], nextRecordsUrl: next });
    fakeConn.request.mockResolvedValue({ done: false, records: [{ Id: 'x' }], nextRecordsUrl: next });
    const err = await client.query('SELECT Id FROM ApexClass').catch((e: unknown) => e);
    expect((err as any).errorCode).toBe('QUERY_TOO_LARGE');
  });

  describe('getRecord()', () => {
    it('calls conn.request with the correct tooling REST path', async () => {
      const mockRecord = { Id: 'abc', Metadata: { ipRelaxation: 'BYPASS' } };
      fakeConn.request.mockResolvedValue(mockRecord);

      const result = await client.getRecord<typeof mockRecord>('ConnectedApplication', 'abc');

      expect(fakeConn.request).toHaveBeenCalledWith(
        '/services/data/v67.0/tooling/sobjects/ConnectedApplication/abc/'
      );
      expect(result).toEqual(mockRecord);
    });
  });

  it('rejects with an ApiError when the connection raises a jsforce error', async () => {
    fakeConn.tooling.query.mockRejectedValue(Object.assign(new Error('sObject type x'), { name: 'INVALID_TYPE', errorCode: 'INVALID_TYPE', data: { errorCode: 'INVALID_TYPE' } }));
    fakeConn.request.mockRejectedValue(Object.assign(new Error('sObject type x'), { name: 'INVALID_TYPE', errorCode: 'INVALID_TYPE', data: { errorCode: 'INVALID_TYPE' } }));
    for (const call of [() => client.query('x'), () => client.getRecord('ApexClass', '01p')]) {
      const err = await call().catch((e: unknown) => e);
      expect(isApiError(err)).toBe(true);
      expect((err as any).errorCode).toBe('INVALID_TYPE');
    }
  });
});
