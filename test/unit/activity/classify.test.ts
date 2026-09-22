import { describe, it, expect } from '@jest/globals';
import { classify } from '../../../src/activity/classify.js';

describe('classify', () => {
  it('reads SOAP operations from the operation, since SOAP leaves HTTP_METHOD blank', () => {
    expect(classify({ family: 'SOAP', operation: 'query' })).toBe('read');
    expect(classify({ family: 'SOAP', operation: 'queryAll' })).toBe('read');
    expect(classify({ family: 'SOAP', operation: 'retrieve' })).toBe('read');
    expect(classify({ family: 'SOAP', operation: 'describeSObject' })).toBe('read');
  });

  it('treats SOAP mutations as writes', () => {
    expect(classify({ family: 'SOAP', operation: 'create' })).toBe('write');
    expect(classify({ family: 'SOAP', operation: 'update' })).toBe('write');
    expect(classify({ family: 'SOAP', operation: 'upsert' })).toBe('write');
    expect(classify({ family: 'SOAP', operation: 'merge' })).toBe('write');
  });

  it('separates destructive SOAP operations from ordinary writes', () => {
    expect(classify({ family: 'SOAP', operation: 'delete' })).toBe('destructive');
    expect(classify({ family: 'SOAP', operation: 'undelete' })).toBe('destructive');
    expect(classify({ family: 'SOAP', operation: 'emptyRecycleBin' })).toBe('destructive');
  });

  it('classifies session plumbing as control so it cannot inflate the read count', () => {
    expect(classify({ family: 'SOAP', operation: 'getServerTimestamp' })).toBe('control');
    expect(classify({ family: 'SOAP', operation: 'login' })).toBe('control');
  });

  it('uses the HTTP method for REST', () => {
    expect(classify({ family: 'REST', operation: 'GET', resource: '/v61.0/sobjects/Account' })).toBe('read');
    expect(classify({ family: 'REST', operation: 'HEAD', resource: '/v61.0/sobjects' })).toBe('read');
    expect(classify({ family: 'REST', operation: 'PATCH', resource: '/v61.0/sobjects/Account/001' })).toBe('write');
    expect(classify({ family: 'REST', operation: 'PUT', resource: '/v61.0/sobjects/Account/001' })).toBe('write');
    expect(classify({ family: 'REST', operation: 'DELETE', resource: '/v61.0/sobjects/Account/001' })).toBe('destructive');
  });

  it('lets the resource override the method, so POST /query is a read in any resource shape', () => {
    expect(classify({ family: 'REST', operation: 'POST', resource: '/v61.0/query' })).toBe('read');
    expect(classify({ family: 'REST', operation: 'POST', resource: '/v61.0/queryAll/?q=SELECT' })).toBe('read');
    expect(classify({ family: 'REST', operation: 'POST', resource: '/v61.0/search' })).toBe('read');
    expect(classify({ family: 'REST', operation: 'POST', resource: '/v61.0/parameterizedSearch' })).toBe('read');
    expect(classify({ family: 'REST', operation: 'GET', resource: '/v61.0/limits' })).toBe('read');
    expect(classify({ family: 'REST', operation: 'POST', resource: '/services/data/v61.0/query' })).toBe('read');
  });

  it('refuses to guess at an undecomposed composite request in any resource shape', () => {
    expect(classify({ family: 'REST', operation: 'POST', resource: '/v61.0/composite' })).toBe('unknown');
    expect(classify({ family: 'REST', operation: 'POST', resource: '/v61.0/composite/graph' })).toBe('unknown');
    expect(classify({ family: 'REST', operation: 'POST', resource: '/services/data/v58.0/composite' })).toBe('unknown');
    expect(classify({ family: 'REST', operation: 'POST', resource: '/composite' })).toBe('unknown');
  });

  it('classifies a composite subresource that names its own operation', () => {
    expect(classify({ family: 'REST', operation: 'POST', resource: '/v52.0/composite/sobjects' })).toBe('write');
    expect(classify({ family: 'REST', operation: 'DELETE', resource: '/v52.0/composite/sobjects?ids=a,b' })).toBe('destructive');
  });

  it('is case-insensitive about the method and the operation', () => {
    expect(classify({ family: 'rest', operation: 'get', resource: '/v61.0/sobjects' })).toBe('read');
    expect(classify({ family: 'soap', operation: 'CREATE' })).toBe('write');
  });

  it('returns unknown rather than guessing for anything unrecognised', () => {
    expect(classify({ family: 'BULK', operation: 'somethingNew' })).toBe('unknown');
    expect(classify({ family: 'SOAP', operation: '' })).toBe('unknown');
  });
});
