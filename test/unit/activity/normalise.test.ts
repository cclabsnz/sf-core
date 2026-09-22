import { describe, it, expect } from '@jest/globals';
import { normalise, SUPPORTED_EVENT_TYPES, isSupportedEventType } from '../../../src/activity/normalise.js';

describe('normalise', () => {
  it('reads a SOAP ApiTotalUsage row, taking the operation from API_RESOURCE', () => {
    const rows = [{
      TIMESTAMP_DERIVED: '2026-09-14T12:31:02.162Z',
      USER_NAME: 'svc@example.test',
      CONNECTED_APP_NAME: 'Example Integration',
      API_FAMILY: 'SOAP',
      HTTP_METHOD: '',
      API_RESOURCE: 'query',
      ENTITY_NAME: 'OrderItem',
      REQUEST_ID: 'REQ1',
      CLIENT_IP: '192.0.2.10',
      STATUS_CODE: '200',
    }];
    const [e] = normalise(rows, 'ApiTotalUsage');
    expect(e.at).toBe('2026-09-14T12:31:02.162Z');
    expect(e.actor).toBe('svc@example.test');
    expect(e.app).toBe('Example Integration');
    expect(e.family).toBe('SOAP');
    expect(e.operation).toBe('query');
    expect(e.entity).toBe('OrderItem');
    expect(e.kind).toBe('read');
    expect(e.requestId).toBe('REQ1');
    expect(e.eventType).toBe('ApiTotalUsage');
    expect(e.raw.USER_NAME).toBe('svc@example.test');
  });

  it('reads a REST ApiTotalUsage row, taking the operation from HTTP_METHOD', () => {
    const rows = [{
      TIMESTAMP_DERIVED: '2026-09-06T01:00:00.000Z',
      USER_NAME: 'a@b.com',
      API_FAMILY: 'REST',
      HTTP_METHOD: 'POST',
      API_RESOURCE: '/v61.0/composite',
      REQUEST_ID: 'REQ2',
    }];
    const [e] = normalise(rows, 'ApiTotalUsage');
    expect(e.operation).toBe('POST');
    expect(e.resource).toBe('/v61.0/composite');
    expect(e.kind).toBe('unknown');
  });

  it('leaves app undefined when the log records it blank, as it does for CLI traffic', () => {
    const rows = [{
      TIMESTAMP_DERIVED: '2026-09-06T01:00:00.000Z',
      USER_NAME: 'a@b.com',
      CONNECTED_APP_NAME: '',
      API_FAMILY: 'REST',
      HTTP_METHOD: 'GET',
      API_RESOURCE: '/v61.0/sobjects',
    }];
    expect(normalise(rows, 'ApiTotalUsage')[0].app).toBeUndefined();
  });

  it('reads a RestApi row, whose fields are named differently', () => {
    const rows = [{
      TIMESTAMP_DERIVED: '2026-09-06T02:00:00.000Z',
      USER_ID_DERIVED: '005xx0000000001AAA',
      METHOD: 'POST',
      URI: '/services/data/v58.0/sobjects/Notice__e',
      ENTITY_NAME: 'Notice__e',
      REQUEST_ID: 'REQ3',
      STATUS_CODE: '201',
      CLIENT_IP: '192.0.2.20',
    }];
    const [e] = normalise(rows, 'RestApi');
    expect(e.family).toBe('REST');
    expect(e.actor).toBe('005xx0000000001AAA');
    expect(e.actorId).toBe('005xx0000000001AAA');
    expect(e.operation).toBe('POST');
    expect(e.kind).toBe('write');
    expect(e.status).toBe('201');
  });

  it('leaves app unset for RestApi even when CONNECTED_APP_ID is present', () => {
    const rows = [{
      TIMESTAMP_DERIVED: '2026-09-06T02:00:00.000Z',
      USER_ID_DERIVED: '005xx0000000001',
      METHOD: 'POST',
      URI: '/services/data/v58.0/sobjects/Notice__e',
      CONNECTED_APP_ID: '888xx00000000001',
    }];
    // `app` is a NAME. RestApi carries an id, in a different id space from ApiTotalUsage for
    // the same app, so writing it here would make one app appear as two in any grouping.
    expect(normalise(rows, 'RestApi')[0].app).toBeUndefined();
  });

  it('reads a CompositeApiSubrequest row, which carries no app and no username', () => {
    const rows = [{
      TIMESTAMP_DERIVED: '2026-09-06T02:00:01.000Z',
      USER_ID: '005xx0000000001AAA',
      METHOD: 'GET',
      URI: '/v52.0/query/',
      REQUEST_ID: 'REQ3',
      STATUS_CODE: '200',
    }];
    const [e] = normalise(rows, 'CompositeApiSubrequest');
    expect(e.app).toBeUndefined();
    expect(e.requestId).toBe('REQ3');
    expect(e.kind).toBe('read');
  });

  it('throws on an event type it has no adapter for', () => {
    expect(() => normalise([], 'NoSuchType')).toThrow(/NoSuchType/);
  });

  it('names its supported types so a caller can check before parsing a file', () => {
    expect(SUPPORTED_EVENT_TYPES).toContain('ApiTotalUsage');
    expect(isSupportedEventType('ApiTotalUsage')).toBe(true);
    expect(isSupportedEventType('NoSuchType')).toBe(false);
  });

  it('skips a row with no usable timestamp rather than emitting an invalid event', () => {
    const rows = [{ USER_NAME: 'a@b.com', API_FAMILY: 'SOAP', API_RESOURCE: 'query' }];
    expect(normalise(rows, 'ApiTotalUsage')).toEqual([]);
  });

  it('normalises a timestamp without milliseconds to millisecond precision', () => {
    const rows = [{
      TIMESTAMP_DERIVED: '2026-09-14T12:31:02Z',
      USER_NAME: 'a@b.com',
      API_FAMILY: 'SOAP',
      API_RESOURCE: 'query',
    }];
    expect(normalise(rows, 'ApiTotalUsage')[0].at).toBe('2026-09-14T12:31:02.000Z');
  });

  it('reads a legacy API row, whose operation lives in METHOD_NAME', () => {
    const rows = [{
      TIMESTAMP_DERIVED: '2026-09-06T03:00:00.000Z',
      USER_ID: '005xx0000000001AAA',
      API_TYPE: 'SOAP',
      METHOD_NAME: 'query',
      ENTITY_NAME: 'Account',
      CLIENT_NAME: 'Dataloader Bulk',
    }];
    const [e] = normalise(rows, 'API');
    expect(e.family).toBe('SOAP');
    expect(e.operation).toBe('query');
    expect(e.entity).toBe('Account');
    expect(e.app).toBe('Dataloader Bulk');
    expect(e.kind).toBe('read');
  });

  it('reads a Login row as control, whatever the log calls its app field', () => {
    const rows = [{
      TIMESTAMP_DERIVED: '2026-09-06T04:00:00.000Z',
      USER_ID: '005xx0000000001AAA',
      APP_NAME: 'Salesforce CLI',
      LOGIN_STATUS: 'LOGIN_NO_ERROR',
      SOURCE_IP: '203.0.113.7',
    }];
    const [e] = normalise(rows, 'Login');
    expect(e.family).toBe('LOGIN');
    expect(e.kind).toBe('control');
    expect(e.app).toBe('Salesforce CLI');
    expect(e.sourceIp).toBe('203.0.113.7');
  });
});
