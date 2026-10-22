import { SalesforceApiError } from '../../../src/api/ApiError.js';
import { classifyEventLogAccessError } from '../../../src/events/eventLogAccess.js';

const err = (code: string, statusCode?: number, message = 'm') => new SalesforceApiError(code, message, { statusCode });

describe('classifyEventLogAccessError', () => {
  it.each([
    ['INSUFFICIENT_ACCESS', 'no-permission'],
    ['INSUFFICIENT_ACCESS_OR_READONLY', 'no-permission'],
    ['ERROR_HTTP_403', 'no-permission'],
    ['INVALID_TYPE', 'not-enabled'],
    ['NOT_FOUND', 'not-enabled'],
    ['MALFORMED_QUERY', 'not-enabled'],
    ['ERROR_HTTP_404', 'not-enabled'],
    ['ERROR_HTTP_400', 'not-enabled'],
    ['ERROR_HTTP_500', 'unknown'],
  ])('classifies %s as %s', (code, expected) => {
    expect(classifyEventLogAccessError(err(code))).toBe(expected);
  });

  // The fetch transport keeps the HTTP status; jsforce does not. The same org error must
  // classify the same way on both.
  it.each([
    ['API_DISABLED_FOR_ORG', 403],
    ['REQUEST_LIMIT_EXCEEDED', 400],
    ['INVALID_OPERATION', 404],
    ['INVALID_TYPE', 400],
    ['INSUFFICIENT_ACCESS', 403],
  ])('classifies %s identically with and without statusCode %d', (code, status) => {
    expect(classifyEventLogAccessError(err(code, status))).toBe(classifyEventLogAccessError(err(code)));
  });

  it('still reads the message when there is no recognisable code', () => {
    expect(classifyEventLogAccessError(new Error("sObject type 'EventLogFile' is not supported"))).toBe('not-enabled');
    expect(classifyEventLogAccessError(new Error('INSUFFICIENT_ACCESS: no permission'))).toBe('no-permission');
    expect(classifyEventLogAccessError(new Error('boom'))).toBe('unknown');
  });
});
