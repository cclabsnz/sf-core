import { isCompositeContainer, resourceSegments } from './resource.js';
import type { ActivityKind } from './types.js';

const SOAP_READ = new Set([
  'query', 'queryall', 'querymore', 'retrieve', 'getupdated', 'getdeleted',
  'describesobject', 'describesobjects', 'describeglobal', 'describelayout',
]);
const SOAP_WRITE = new Set(['create', 'update', 'upsert', 'merge', 'convertlead', 'process']);
const SOAP_DESTRUCTIVE = new Set(['delete', 'undelete', 'emptyrecyclebin']);
const SOAP_CONTROL = new Set([
  'getservertimestamp', 'login', 'logout', 'getuserinfo', 'setpassword', 'resetpassword',
]);

const REST_READ_METHODS = new Set(['get', 'head']);
const REST_WRITE_METHODS = new Set(['post', 'patch', 'put']);

/**
 * Resource path segments that are reads whatever the method says.
 *
 * `POST /query` is the reason this exists: the method says write and the call is a read. A
 * classifier that trusts the method alone reports every paginated SOQL call as a mutation.
 */
const REST_READ_RESOURCES = ['/query', '/queryall', '/search', '/parameterizedsearch', '/limits'];

/**
 * Classify one operation.
 *
 * Order matters for REST: the resource is consulted before the method, because the resource is
 * the more specific signal and the method lies about `/query`.
 */
export function classify(input: {
  family: string;
  operation: string;
  resource?: string;
}): ActivityKind {
  const family = input.family.trim().toLowerCase();
  const op = input.operation.trim().toLowerCase();
  const resource = (input.resource ?? '').trim().toLowerCase();

  if (family === 'soap') {
    if (SOAP_CONTROL.has(op)) return 'control';
    if (SOAP_DESTRUCTIVE.has(op)) return 'destructive';
    if (SOAP_WRITE.has(op)) return 'write';
    if (SOAP_READ.has(op)) return 'read';
    if (op.startsWith('describe')) return 'read';
    return 'unknown';
  }

  if (family === 'rest') {
    const seg = resourceSegments(resource)[0];

    // A bare composite carries no operation of its own. Guessing here was wrong for 80% of
    // one integration's traffic; decomposeComposite resolves it, and until then it is unknown.
    // e.g. /composite/sobjects is not a container — its subresource names an operation.
    if (seg === 'composite' && isCompositeContainer(resource)) return 'unknown';

    if (REST_READ_RESOURCES.some((r) => resource.includes(r))) return 'read';
    if (REST_READ_METHODS.has(op)) return 'read';
    if (op === 'delete') return 'destructive';
    if (REST_WRITE_METHODS.has(op)) return 'write';
    return 'unknown';
  }

  return 'unknown';
}
