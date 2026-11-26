/** The bucket does not exist (S3 NoSuchBucket). */
export class BucketMissingError extends Error {
  readonly bucket: string;
  constructor(bucket: string, message?: string) {
    super(message ?? `Bucket "${bucket}" does not exist`);
    this.name = 'BucketMissingError';
    this.bucket = bucket;
  }
}

/** The credentials were rejected for the bucket (AccessDenied / HTTP 403). */
export class StorageAccessDeniedError extends Error {
  readonly bucket: string;
  constructor(bucket: string, message?: string) {
    super(message ?? `Access denied to bucket "${bucket}"`);
    this.name = 'StorageAccessDeniedError';
    this.bucket = bucket;
  }
}
