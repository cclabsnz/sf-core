import { apiErrorFromResponse, isApiError, normaliseApiError, SalesforceApiError } from '../../../src/api/ApiError.js';
import { jsforceError, jsforceGetError } from './helpers/jsforce.js';

const JSON_TYPE = 'application/json;charset=UTF-8';

const res = (status: number, body: string, contentType = JSON_TYPE) =>
  new Response(body, { status, headers: { 'content-type': contentType } });

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
  it('reads errorCode and message from a one-entry array body', async () => {
    const e = await apiErrorFromResponse(res(400, '[{"message":"No such column","errorCode":"INVALID_FIELD"}]'));
    expect(e.errorCode).toBe('INVALID_FIELD');
    expect(e.statusCode).toBe(400);
    expect(e.message).toBe('No such column');
    expect(e.details).toEqual({ message: 'No such column', errorCode: 'INVALID_FIELD' });
  });

  it('gives MULTIPLE_API_ERRORS for an array of more than one entry', async () => {
    const body = '[{"message":"a","errorCode":"A"},{"message":"b","errorCode":"B"}]';
    const e = await apiErrorFromResponse(res(400, body));
    expect(e.errorCode).toBe('MULTIPLE_API_ERRORS');
    expect(e.details).toEqual(JSON.parse(body));
  });

  it('gives ERROR_HTTP_<status> with the raw body for a non-JSON body', async () => {
    const html = '<html>' + 'x'.repeat(994);
    const e = await apiErrorFromResponse(res(503, html, 'text/html;charset=UTF-8'));
    expect(e.errorCode).toBe('ERROR_HTTP_503');
    expect(e.message).toBe(html);
  });

  it('gives ERROR_HTTP_<status> for an OAuth-shaped body, which carries no message', async () => {
    const e = await apiErrorFromResponse(res(400, '{"error":"invalid_grant","error_description":"expired"}'));
    expect(e.errorCode).toBe('ERROR_HTTP_400');
  });

  it('gives ERROR_HTTP_<status> for an empty body', async () => {
    const e = await apiErrorFromResponse(res(500, '', 'text/plain'));
    expect(e.errorCode).toBe('ERROR_HTTP_500');
  });

  // jsforce's own HttpApi.getError is the oracle: the Connection transport raises exactly this.
  describe('matches jsforce getError', () => {
    const cases: [string, number, string, string][] = [
      ['one entry', 400, JSON_TYPE, '[{"message":"No such column","errorCode":"INVALID_FIELD"}]'],
      ['two entries', 400, JSON_TYPE, '[{"message":"a","errorCode":"A"},{"message":"b","errorCode":"B"}]'],
      ['an empty array', 400, JSON_TYPE, '[]'],
      ['a bare object', 404, JSON_TYPE, '{"message":"gone","errorCode":"NOT_FOUND"}'],
      ['a message with no errorCode', 400, JSON_TYPE, '{"message":"odd"}'],
      ['an OAuth body', 401, JSON_TYPE, '{"error":"invalid_grant","error_description":"expired"}'],
      ['JSON sent as text/plain', 400, 'text/plain', '[{"message":"m","errorCode":"X"}]'],
      ['malformed JSON', 500, JSON_TYPE, '[{"message":'],
      ['an empty body', 500, 'text/plain', ''],
      ['html with a charset', 503, 'text/html;charset=UTF-8', '<html>down</html>'],
      ['bare text/html', 503, 'text/html', '<html>down</html>'],
    ];
    it.each(cases)('for %s', async (_name, status, contentType, body) => {
      const ours = await apiErrorFromResponse(res(status, body, contentType));
      const theirs = await jsforceGetError(status, contentType, body);
      expect({ errorCode: ours.errorCode, name: ours.name, message: ours.message, details: ours.details }).toEqual({
        errorCode: theirs.errorCode,
        name: theirs.name,
        message: theirs.message,
        details: theirs.data,
      });
    });
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
