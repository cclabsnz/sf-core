import { HttpApi } from '@jsforce/jsforce-node/lib/http-api.js';

/** The shape of jsforce's HttpApiError: name and errorCode are the Salesforce code, data the details. */
export type JsforceError = Error & { errorCode: string; data: unknown };

/** A jsforce-shaped failure, as a Connection client sees one: errorCode and data, no statusCode. */
export function jsforceError(errorCode = 'INVALID_TYPE', message = 'sObject type x'): JsforceError {
  return Object.assign(new Error(message), { name: errorCode, errorCode, data: { errorCode, message } });
}

/**
 * jsforce's own HttpApi.getError over a recorded response: exactly the error the Connection
 * transport raises. HttpApi only reads `_logLevel` from the connection when built; getError makes
 * no network call.
 */
export function jsforceGetError(status: number, contentType: string, body: string): Promise<JsforceError> {
  const api = new HttpApi({} as never, {}) as unknown as { getError(r: unknown): Promise<JsforceError> };
  return api.getError({ statusCode: status, headers: { 'content-type': contentType }, body });
}
