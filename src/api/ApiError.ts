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

interface ErrorEntry {
  errorCode?: unknown;
  message?: unknown;
  error?: unknown;
  error_description?: unknown;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** Builds an ApiError from a non-OK Salesforce HTTP response (data API array body or OAuth object body). */
export async function apiErrorFromResponse(res: {
  status: number;
  text(): Promise<string>;
}): Promise<SalesforceApiError> {
  const text = await res.text();
  const fallbackCode = `HTTP_${res.status}`;
  const fallbackMessage = text === '' ? `Salesforce returned HTTP ${res.status}.` : text.slice(0, 300);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new SalesforceApiError(fallbackCode, fallbackMessage, { statusCode: res.status });
  }
  const entry = (Array.isArray(parsed) ? parsed[0] : parsed) as ErrorEntry | null | undefined;
  const isObject = typeof entry === 'object' && entry !== null;
  const code = isObject ? str(entry.errorCode) ?? str(entry.error) : undefined;
  const message = isObject ? str(entry.message) ?? str(entry.error_description) : undefined;
  return new SalesforceApiError(code ?? fallbackCode, message ?? `Salesforce returned HTTP ${res.status}.`, {
    statusCode: res.status,
    details: parsed,
  });
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
