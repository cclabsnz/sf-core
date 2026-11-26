import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { createS3ObjectStore, s3ClientConfig } from '../../../src/storage/S3ObjectStoreImpl.js';
import { BucketMissingError, StorageAccessDeniedError } from '../../../src/storage/errors.js';

const EP = { endpoint: 'https://x.r2.cloudflarestorage.com', region: 'auto', custom: true };

type Cmd = { constructor: { name: string }; input: Record<string, unknown> };

function fake(respond: (cmd: Cmd) => unknown | Promise<unknown>) {
  const sent: Cmd[] = [];
  return {
    sent,
    client: {
      send: async (cmd: unknown) => {
        sent.push(cmd as Cmd);
        return respond(cmd as Cmd);
      },
    },
  };
}

function awsError(name: string, status: number, message = name): Error {
  return Object.assign(new Error(message), { name, $metadata: { httpStatusCode: status } });
}

describe('S3ObjectStoreImpl', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('get sends GetObjectCommand and returns the body bytes', async () => {
    const f = fake(() => ({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } }));
    const store = await createS3ObjectStore('bkt', EP, { client: f.client });
    const out = await store.get('a/b');
    expect(out).toEqual(Buffer.from([1, 2, 3]));
    expect(f.sent[0].constructor.name).toBe('GetObjectCommand');
    expect(f.sent[0].input).toEqual({ Bucket: 'bkt', Key: 'a/b' });
  });

  it('get returns null for NoSuchKey and for 404', async () => {
    for (const err of [awsError('NoSuchKey', 404), awsError('NotFound', 404)]) {
      const store = await createS3ObjectStore('bkt', EP, { client: fake(() => { throw err; }).client });
      expect(await store.get('k')).toBeNull();
    }
  });

  it('put sends PutObjectCommand', async () => {
    const f = fake(() => ({}));
    const store = await createS3ObjectStore('bkt', EP, { client: f.client });
    const body = Buffer.from('hi');
    await store.put('k', body, 'text/plain');
    expect(f.sent[0].constructor.name).toBe('PutObjectCommand');
    expect(f.sent[0].input).toEqual({ Bucket: 'bkt', Key: 'k', Body: body, ContentType: 'text/plain' });
  });

  it('putIfAbsent adds IfNoneMatch and returns true on success', async () => {
    const f = fake(() => ({}));
    const store = await createS3ObjectStore('bkt', EP, { client: f.client });
    expect(await store.putIfAbsent('k', Buffer.from('x'), 'text/plain')).toBe(true);
    expect(f.sent[0].input.IfNoneMatch).toBe('*');
  });

  it('putIfAbsent returns false on 412 or PreconditionFailed', async () => {
    for (const err of [awsError('Whatever', 412), awsError('PreconditionFailed', 0)]) {
      const store = await createS3ObjectStore('bkt', EP, { client: fake(() => { throw err; }).client });
      expect(await store.putIfAbsent('k', Buffer.from('x'), 'text/plain')).toBe(false);
    }
  });

  it('list maps contents, prefixes and continuation tokens', async () => {
    const f = fake(() => ({
      Contents: [{ Key: 'p/a', Size: 3 }, { Key: 'p/b' }],
      CommonPrefixes: [{ Prefix: 'p/d/' }],
      NextContinuationToken: 'tok2',
    }));
    const store = await createS3ObjectStore('bkt', EP, { client: f.client });
    const out = await store.list({ prefix: 'p/', delimiter: '/', maxKeys: 2, token: 'tok1' });
    expect(out).toEqual({ keys: [{ key: 'p/a', size: 3 }, { key: 'p/b', size: 0 }], prefixes: ['p/d/'], next: 'tok2' });
    expect(f.sent[0].constructor.name).toBe('ListObjectsV2Command');
    expect(f.sent[0].input).toEqual({
      Bucket: 'bkt', Prefix: 'p/', Delimiter: '/', MaxKeys: 2, ContinuationToken: 'tok1',
    });
  });

  it('list of an empty page has no next', async () => {
    const store = await createS3ObjectStore('bkt', EP, { client: fake(() => ({})).client });
    expect(await store.list({ prefix: '' })).toEqual({ keys: [], prefixes: [], next: undefined });
  });

  it('maps NoSuchBucket to BucketMissingError', async () => {
    const store = await createS3ObjectStore('bkt', EP, { client: fake(() => { throw awsError('NoSuchBucket', 404); }).client });
    const err = await store.list({ prefix: '' }).catch((e) => e);
    expect(err).toBeInstanceOf(BucketMissingError);
    expect(err.bucket).toBe('bkt');
  });

  it('maps AccessDenied and 403 to StorageAccessDeniedError naming the bucket', async () => {
    for (const e of [awsError('AccessDenied', 403), awsError('Forbidden', 403)]) {
      const store = await createS3ObjectStore('bkt', EP, { client: fake(() => { throw e; }).client });
      const err = await store.put('k', Buffer.from('x'), 'a/b').catch((x) => x);
      expect(err).toBeInstanceOf(StorageAccessDeniedError);
      expect(err.bucket).toBe('bkt');
      expect(err.message).toContain('bkt');
    }
  });

  describe('redaction', () => {
    beforeEach(() => {
      process.env.AWS_SECRET_ACCESS_KEY = 'SECRETVALUE123';
      process.env.AWS_SESSION_TOKEN = 'SESSIONTOKEN456';
      process.env.AWS_ACCESS_KEY_ID = 'AKIDVALUE789';
    });

    it('redacts credential values from rethrown errors', async () => {
      const msg = 'boom SECRETVALUE123 and SESSIONTOKEN456 and AKIDVALUE789';
      const store = await createS3ObjectStore('bkt', EP, { client: fake(() => { throw awsError('InternalError', 500, msg); }).client });
      const err = await store.get('k').catch((e) => e);
      expect(err.message).toContain('[redacted]');
      for (const s of ['SECRETVALUE123', 'SESSIONTOKEN456', 'AKIDVALUE789']) expect(err.message).not.toContain(s);
    });

    it('redacts from access-denied messages too', async () => {
      const msg = 'denied SECRETVALUE123';
      const store = await createS3ObjectStore('bkt', EP, { client: fake(() => { throw awsError('AccessDenied', 403, msg); }).client });
      const err = await store.get('k').catch((e) => e);
      expect(err).toBeInstanceOf(StorageAccessDeniedError);
      expect(err.message).not.toContain('SECRETVALUE123');
    });
  });
});

describe('s3ClientConfig', () => {
  it('configures path-style and WHEN_REQUIRED checksums for a custom endpoint', () => {
    expect(s3ClientConfig(EP)).toEqual({
      region: 'auto',
      endpoint: 'https://x.r2.cloudflarestorage.com',
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  });

  it('is virtual-hosted for AWS but still sets the endpoint', () => {
    const cfg = s3ClientConfig({ endpoint: 'https://s3.ap-southeast-2.amazonaws.com', region: 'ap-southeast-2', custom: false });
    expect(cfg.forcePathStyle).toBe(false);
    expect(cfg.endpoint).toBe('https://s3.ap-southeast-2.amazonaws.com');
  });
});
