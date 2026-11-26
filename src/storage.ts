// The ./storage entry point: an S3-compatible ObjectStore. @aws-sdk/client-s3 is an optional peer,
// loaded only when createS3ObjectStore runs.
export * from './storage/index.js';
