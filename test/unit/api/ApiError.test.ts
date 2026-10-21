import { apiErrorFromResponse, isApiError, normaliseApiError, SalesforceApiError } from '../../../src/api/ApiError.js';

const jsforceError = () =>
  Object.assign(new Error('sObject type x'), {
    name: 'INVALID_TYPE',
    errorCode: 'INVALID_TYPE',
    data: { errorCode: 'INVALID_TYPE' },
  });

const res = (status: number, body: string) => ({ status, text: async () => body });

describe('isApiError', () => {
  it('returns true for an object with errorCode (string) and statusCode (number)', () => {
    const err = Object.assign(new Error('API error'), { errorCode: 'INVALID_TYPE', statusCode: 400 });
    expect(isApiError(err)).toBe(true);
  });

  it('returns false for a plain Error with no extra fields', () => {
    expect(isApiError(new Error('plain'))).toBe(false);
  });

  it('returns false when errorCode is missing', () => {
    const err = Object.assign(new Error('x'), { statusCode: 400 });
    expect(isApiError(err)).toBe(false);
  });

  it('returns true when statusCode is absent (jsforce errors carry none)', () => {
    expect(isApiError(new SalesforceApiError('INVALID_FIELD', 'x'))).toBe(true);
    expect(isApiError(Object.assign(new Error('x'), { errorCode: 'INVALID' }))).toBe(true);
  });

  it('returns false when errorCode is not a string', () => {
    expect(isApiError(Object.assign(new Error('x'), { errorCode: 42 }))).toBe(false);
  });

  it('returns false when statusCode is present but not a number', () => {
    expect(isApiError(Object.assign(new Error('x'), { errorCode: 'X', statusCode: '400' }))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isApiError(null)).toBe(false);
    expect(isApiError('string')).toBe(false);
    expect(isApiError({ errorCode: 'X', statusCode: 400 })).toBe(false);
  });
});

describe('SalesforceApiError', () => {
  it('sets name to the errorCode and exposes statusCode and details', () => {
    const e = new SalesforceApiError('INVALID_FIELD', 'm', { statusCode: 400, details: { a: 1 } });
    expect(e.name).toBe('INVALID_FIELD');
    expect(e.statusCode).toBe(400);
    expect(e.details).toEqual({ a: 1 });
  });
});

describe('apiErrorFromResponse', () => {
  it('reads errorCode and message from an array body', async () => {
    const e = await apiErrorFromResponse(res(400, '[{"message":"No such column","errorCode":"INVALID_FIELD"}]'));
    expect(e.errorCode).toBe('INVALID_FIELD');
    expect(e.statusCode).toBe(400);
    expect(e.message).toBe('No such column');
  });

  it('reads error and error_description from an OAuth object body', async () => {
    const e = await apiErrorFromResponse(res(400, '{"error":"invalid_grant","error_description":"expired"}'));
    expect(e.errorCode).toBe('invalid_grant');
    expect(e.message).toBe('expired');
  });

  it('falls back to HTTP_<status> with truncated text for a non-JSON body', async () => {
    const e = await apiErrorFromResponse(res(503, '<html>' + 'x'.repeat(994)));
    expect(e.errorCode).toBe('HTTP_503');
    expect(e.message.length).toBeLessThanOrEqual(300);
  });

  it('uses a stock message for an empty body', async () => {
    const e = await apiErrorFromResponse(res(500, ''));
    expect(e.errorCode).toBe('HTTP_500');
    expect(e.message).toBe('Salesforce returned HTTP 500.');
  });
});

describe('normaliseApiError', () => {
  it('turns a jsforce-shaped error into an ApiError', () => {
    const src = jsforceError();
    const out = normaliseApiError(src) as SalesforceApiError;
    expect(isApiError(out)).toBe(true);
    expect(out.errorCode).toBe('INVALID_TYPE');
    expect(out.name).toBe('INVALID_TYPE');
    expect(out.details).toEqual(src.data);
  });

  it('returns other errors as the same instance', () => {
    const t = new TypeError('boom');
    expect(normaliseApiError(t)).toBe(t);
    expect(normaliseApiError('str')).toBe('str');
  });
});
