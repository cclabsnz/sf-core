/** Where objects live: a bucket and a key prefix ('' or 'a/b', no leading or trailing '/'). */
export interface S3Location {
  bucket: string;
  prefix: string;
}

export function isS3Uri(s: string): boolean {
  return s.startsWith('s3://');
}

export function parseS3Uri(uri: string): S3Location {
  if (!isS3Uri(uri)) throw new Error(`Not an s3:// URI: ${uri}`);
  const rest = uri.slice('s3://'.length);
  const slash = rest.indexOf('/');
  const bucket = slash === -1 ? rest : rest.slice(0, slash);
  if (!bucket) throw new Error(`s3:// URI has no bucket: ${uri}`);
  const prefix = (slash === -1 ? '' : rest.slice(slash + 1)).replace(/^\/+|\/+$/g, '');
  return { bucket, prefix };
}

export interface S3Endpoint {
  endpoint: string;
  region: string;
  /** True when the endpoint came from the environment (R2, MinIO...) rather than the AWS region. */
  custom: boolean;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Resolve the endpoint from the standard AWS environment variables.
 * `AWS_ENDPOINT_URL_S3` beats `AWS_ENDPOINT_URL`; `AWS_REGION` beats `AWS_DEFAULT_REGION`.
 * A custom endpoint defaults the region to `auto` (Cloudflare R2); with none, a region is required.
 */
export function resolveS3Endpoint(env: NodeJS.ProcessEnv): S3Endpoint {
  const region = env.AWS_REGION || env.AWS_DEFAULT_REGION || undefined;
  const custom = env.AWS_ENDPOINT_URL_S3 || env.AWS_ENDPOINT_URL || undefined;
  if (!custom) {
    if (!region) {
      throw new Error('Set AWS_REGION (for AWS S3) or AWS_ENDPOINT_URL_S3 (for R2 or another S3-compatible service).');
    }
    if (!/^[a-z0-9-]+$/.test(region)) throw new Error('AWS_REGION is not a valid region name.');
    return { endpoint: `https://s3.${region}.amazonaws.com`, region, custom: false };
  }
  let url: URL;
  try {
    url = new URL(custom);
  } catch {
    throw new Error('The S3 endpoint (AWS_ENDPOINT_URL_S3 or AWS_ENDPOINT_URL) is not a valid URL.');
  }
  if (url.username || url.password) throw new Error('The S3 endpoint must not contain credentials.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    throw new Error('The S3 endpoint (AWS_ENDPOINT_URL_S3 or AWS_ENDPOINT_URL) must use https; http is allowed only for localhost.');
  }
  return { endpoint: custom, region: region ?? 'auto', custom: true };
}

/**
 * The host the S3 client actually contacts for `bucket`, for naming network destinations truthfully.
 * A custom endpoint (R2, MinIO...) is used path-style, so the host is the endpoint's own host.
 * AWS S3 is used virtual-hosted style, so the bucket is part of the host:
 * `<bucket>.s3.<region>.amazonaws.com`. The SDK falls back to path style, and so to
 * `s3.<region>.amazonaws.com`, for a bucket name that cannot be a single DNS label over https
 * (one with a dot, upper case or an underscore), and this mirrors that rule.
 */
export function s3Host(bucket: string, ep: S3Endpoint): string {
  if (ep.custom) return new URL(ep.endpoint).host;
  return VIRTUAL_HOSTABLE.test(bucket) ? `${bucket}.s3.${ep.region}.amazonaws.com` : `s3.${ep.region}.amazonaws.com`;
}

/** The AWS SDK's isVirtualHostableS3Bucket without sub-domains: 3-63 lower-case letters, digits and inner hyphens. */
const VIRTUAL_HOSTABLE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
