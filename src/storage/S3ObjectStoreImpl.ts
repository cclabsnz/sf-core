import type { ObjectStore } from './ObjectStore.js';
import { BucketMissingError, StorageAccessDeniedError } from './errors.js';
import type { S3Endpoint } from './s3Location.js';

export interface S3ObjectStoreOptions {
  /** Tests inject a fake; otherwise an S3Client is built from the endpoint. */
  client?: { send(cmd: unknown): Promise<unknown> };
}

/** S3Client settings. Path-style and WHEN_REQUIRED checksums keep R2 and other S3-compatible services happy. */
export function s3ClientConfig(ep: S3Endpoint): Record<string, unknown> {
  return {
    region: ep.region,
    endpoint: ep.endpoint,
    forcePathStyle: ep.custom,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };
}

const SECRET_ENV = ['AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_ACCESS_KEY_ID'] as const;

/** Replace any credential value found in the environment with [redacted]. */
function redact(text: string): string {
  let out = text;
  for (const name of SECRET_ENV) {
    const v = process.env[name];
    if (v && v.length >= 4) out = out.split(v).join('[redacted]');
  }
  return out;
}

interface AwsLikeError {
  name?: string;
  message?: string;
  $metadata?: { httpStatusCode?: number };
}

function statusOf(e: AwsLikeError): number | undefined {
  return e.$metadata?.httpStatusCode;
}

function isNotFound(e: AwsLikeError): boolean {
  return e.name === 'NoSuchKey' || e.name === 'NotFound' || statusOf(e) === 404;
}

function isPreconditionFailed(e: AwsLikeError): boolean {
  return e.name === 'PreconditionFailed' || statusOf(e) === 412;
}

function toStorageError(err: unknown, bucket: string): Error {
  const e = (err ?? {}) as AwsLikeError;
  const message = redact(e.message ?? String(err));
  if (e.name === 'NoSuchBucket') return new BucketMissingError(bucket);
  if (e.name === 'AccessDenied' || statusOf(e) === 403) {
    return new StorageAccessDeniedError(bucket, `Access denied to bucket "${bucket}": ${message}`);
  }
  const out = new Error(message);
  if (e.name) out.name = e.name;
  return out;
}

export async function createS3ObjectStore(
  bucket: string,
  ep: S3Endpoint,
  opts: S3ObjectStoreOptions = {},
): Promise<ObjectStore> {
  // One dynamic import serves both the client constructor and the Command classes, so the SDK
  // (an optional peer) is only loaded when a store is actually created.
  const sdk = await import('@aws-sdk/client-s3');
  const client = opts.client ?? new sdk.S3Client(s3ClientConfig(ep));
  const send = (cmd: unknown): Promise<unknown> =>
    (client as { send(cmd: unknown): Promise<unknown> }).send(cmd);

  return {
    async get(key) {
      try {
        const res = (await send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key }))) as {
          Body?: { transformToByteArray(): Promise<Uint8Array> };
        };
        return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : Buffer.alloc(0);
      } catch (err) {
        if (isNotFound(err as AwsLikeError) && (err as AwsLikeError).name !== 'NoSuchBucket') return null;
        throw toStorageError(err, bucket);
      }
    },

    async put(key, bytes, contentType) {
      try {
        await send(new sdk.PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }));
      } catch (err) {
        throw toStorageError(err, bucket);
      }
    },

    async putIfAbsent(key, bytes, contentType) {
      try {
        await send(
          new sdk.PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType, IfNoneMatch: '*' }),
        );
        return true;
      } catch (err) {
        if (isPreconditionFailed(err as AwsLikeError)) return false;
        throw toStorageError(err, bucket);
      }
    },

    async list({ prefix, delimiter, maxKeys, token }) {
      try {
        const res = (await send(
          new sdk.ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ...(delimiter !== undefined && { Delimiter: delimiter }),
            ...(maxKeys !== undefined && { MaxKeys: maxKeys }),
            ...(token !== undefined && { ContinuationToken: token }),
          }),
        )) as {
          Contents?: Array<{ Key?: string; Size?: number }>;
          CommonPrefixes?: Array<{ Prefix?: string }>;
          NextContinuationToken?: string;
        };
        return {
          keys: (res.Contents ?? []).map((o) => ({ key: o.Key ?? '', size: o.Size ?? 0 })),
          prefixes: (res.CommonPrefixes ?? []).map((p) => p.Prefix ?? ''),
          next: res.NextContinuationToken,
        };
      } catch (err) {
        throw toStorageError(err, bucket);
      }
    },
  };
}
