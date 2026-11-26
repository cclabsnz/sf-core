import { isS3Uri, parseS3Uri, resolveS3Endpoint } from '../../../src/storage/s3Location.js';

describe('parseS3Uri', () => {
  it.each([
    ['s3://b', ''],
    ['s3://b/', ''],
    ['s3://b/p', 'p'],
    ['s3://b/p/', 'p'],
    ['s3://b//p', 'p'],
    ['s3://b/a/b/', 'a/b'],
  ])('parses %s', (uri, prefix) => {
    expect(parseS3Uri(uri)).toEqual({ bucket: 'b', prefix });
  });

  it('throws on an empty bucket or a non-s3 URI', () => {
    expect(() => parseS3Uri('s3://')).toThrow();
    expect(() => parseS3Uri('s3:///p')).toThrow();
    expect(() => parseS3Uri('/tmp/x')).toThrow();
  });

  it('isS3Uri recognises the scheme only', () => {
    expect(isS3Uri('s3://b/p')).toBe(true);
    expect(isS3Uri('/tmp/x')).toBe(false);
  });
});

describe('resolveS3Endpoint', () => {
  const R2 = 'https://acct.r2.cloudflarestorage.com';

  it('uses a custom endpoint with region auto by default', () => {
    expect(resolveS3Endpoint({ AWS_ENDPOINT_URL_S3: R2 })).toEqual({ endpoint: R2, region: 'auto', custom: true });
  });

  it('AWS_ENDPOINT_URL_S3 beats AWS_ENDPOINT_URL', () => {
    expect(resolveS3Endpoint({ AWS_ENDPOINT_URL_S3: R2, AWS_ENDPOINT_URL: 'https://other.example.com' }).endpoint).toBe(R2);
    expect(resolveS3Endpoint({ AWS_ENDPOINT_URL: R2 }).endpoint).toBe(R2);
  });

  it('AWS_REGION beats AWS_DEFAULT_REGION', () => {
    const env = { AWS_ENDPOINT_URL_S3: R2, AWS_REGION: 'r1', AWS_DEFAULT_REGION: 'r2' };
    expect(resolveS3Endpoint(env).region).toBe('r1');
    expect(resolveS3Endpoint({ AWS_ENDPOINT_URL_S3: R2, AWS_DEFAULT_REGION: 'r2' }).region).toBe('r2');
  });

  it('derives the AWS endpoint from a region', () => {
    expect(resolveS3Endpoint({ AWS_REGION: 'ap-southeast-2' })).toEqual({
      endpoint: 'https://s3.ap-southeast-2.amazonaws.com',
      region: 'ap-southeast-2',
      custom: false,
    });
  });

  it('throws naming both variables when nothing is set', () => {
    expect(() => resolveS3Endpoint({})).toThrow(/AWS_REGION/);
    expect(() => resolveS3Endpoint({})).toThrow(/AWS_ENDPOINT_URL_S3/);
  });

  it('rejects plain http to a remote host but allows loopback', () => {
    expect(() => resolveS3Endpoint({ AWS_ENDPOINT_URL_S3: 'http://example.com' })).toThrow();
    for (const u of ['http://localhost:9000', 'http://127.0.0.1:9000', 'http://[::1]:9000']) {
      expect(resolveS3Endpoint({ AWS_ENDPOINT_URL_S3: u }).endpoint).toBe(u);
    }
  });

  it('rejects credentials in the endpoint without echoing them', () => {
    const call = () => resolveS3Endpoint({ AWS_ENDPOINT_URL_S3: 'https://user:hunter2@x.example.com' });
    expect(call).toThrow(/must not contain credentials/);
    expect(call).not.toThrow(/hunter2/);
  });

  it('does not echo a scheme-less credential in the error', () => {
    const call = () => resolveS3Endpoint({ AWS_ENDPOINT_URL_S3: 'user:secret@host' });
    expect(call).toThrow(/https/);
    expect(call).not.toThrow(/secret/);
  });

  it('rejects a malformed region', () => {
    expect(() => resolveS3Endpoint({ AWS_REGION: 'evil.com/x' })).toThrow(/region/i);
  });

  it('rejects an unparseable endpoint', () => {
    expect(() => resolveS3Endpoint({ AWS_ENDPOINT_URL_S3: 'not a url' })).toThrow();
  });
});
