export interface ApiError extends Error {
  errorCode: string;
  // jsforce's HttpApiError keeps no HTTP status, so it is optional.
  statusCode?: number;
}

export function isApiError(err: unknown): err is ApiError {
  if (!(err instanceof Error)) return false;
  const e = err as { errorCode?: unknown; statusCode?: unknown };
  return typeof e.errorCode === 'string' && (e.statusCode === undefined || typeof e.statusCode === 'number');
}

export class SalesforceApiError extends Error implements ApiError {
  readonly errorCode: string;
  readonly statusCode?: number;
  readonly details?: unknown;

  constructor(errorCode: string, message: string, opts: { statusCode?: number; details?: unknown } = {}) {
    super(message);
    // jsforce sets name to the Salesforce error code; keep that so existing `name` readers don't change.
    this.name = errorCode;
    this.errorCode = errorCode;
    this.statusCode = opts.statusCode;
    this.details = opts.details;
  }
}

// Messages copied from jsforce's HttpApi.getError, so both transports raise the same text.
const MULTIPLE_MESSAGE = `Multiple errors returned.
  Check \`error.data\` for the error details`;
const htmlMessage = (status: number): string => `HTTP response contains html content.
Check that the org exists and can be reached.

HTTP status code: ${status}.
REST API Status Codes and Error Responses:
https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/errorcodes.htm

See \`error.data\` for the full html response.`;

/**
 * Builds an ApiError from a non-OK Salesforce HTTP response, mirroring jsforce's HttpApi.getError
 * (http-api.js) so the fetch and Connection transports raise the same errorCode, message and details:
 * a body is parsed as JSON only when the content type is application/json; an array of other than
 * one entry is MULTIPLE_API_ERRORS; a body with no string `message` is ERROR_HTTP_<status> with the
 * raw body as the message; an entry with a message but no errorCode gets jsforce's 'Error'.
 */
export async function apiErrorFromResponse(res: {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}): Promise<SalesforceApiError> {
  const text = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  const statusCode = res.status;
  let body: unknown = text;
  if (/^application\/json(;|$)/.test(contentType)) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (Array.isArray(body)) {
    if (body.length !== 1) {
      return new SalesforceApiError('MULTIPLE_API_ERRORS', MULTIPLE_MESSAGE, { statusCode, details: body });
    }
    body = body[0];
  }
  const entry: { errorCode?: unknown; message: string } =
    typeof body === 'object' && body !== null && typeof (body as { message?: unknown }).message === 'string'
      ? (body as { errorCode?: unknown; message: string })
      : { errorCode: `ERROR_HTTP_${statusCode}`, message: text };
  // jsforce's HttpApiError falls back to Error's own name when the code is missing.
  const code = typeof entry.errorCode === 'string' && entry.errorCode !== '' ? entry.errorCode : 'Error';
  // jsforce compares the raw header, so only a bare `text/html` takes this branch.
  if (contentType === 'text/html') {
    return new SalesforceApiError(code, htmlMessage(statusCode), { statusCode, details: entry.message });
  }
  return new SalesforceApiError(code, entry.message, { statusCode, details: entry });
}

/**
 * Wraps a jsforce error (string errorCode, no statusCode) as a SalesforceApiError, so `details` and
 * a uniform class are present whichever transport raised it. Anything else passes through unchanged.
 * (isApiError alone cannot be the gate: it now accepts a statusCode-less error.)
 */
export function normaliseApiError(err: unknown): unknown {
  if (err instanceof Error && !(err instanceof SalesforceApiError)) {
    const { errorCode, statusCode, data } = err as { errorCode?: unknown; statusCode?: unknown; data?: unknown };
    if (typeof errorCode === 'string' && statusCode === undefined) {
      return new SalesforceApiError(errorCode, err.message, { details: data });
    }
  }
  return err;
}
