// src/api/soqlBind.ts
import { isSalesforceId } from '../platform/salesforceId.js';

export class SoqlBindError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SoqlBindError';
  }
}

/** Marker class for explicitly pre-sanitized or raw SOQL fragments */
export class SafeSoqlFragment {
  public constructor(public readonly text: string) {}
  public toString(): string {
    return this.text;
  }
}

/** Escapes a string for safe inclusion in a SOQL single-quoted string literal. */
export function escapeSoqlString(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Validates that `val` is a valid 15- or 18-character Salesforce ID and wraps it in quotes.
 * Throws `SoqlBindError` if invalid.
 */
export function soqlId(val: string): SafeSoqlFragment {
  if (!isSalesforceId(val)) {
    throw new SoqlBindError(`Invalid Salesforce ID for SOQL bind: '${val}'`);
  }
  return new SafeSoqlFragment(`'${val}'`);
}

/**
 * Validates a list of Salesforce IDs and formats them as a comma-separated tuple for `IN (...)`.
 * Throws `SoqlBindError` if any ID is invalid.
 */
export function soqlIds(ids: readonly string[]): SafeSoqlFragment {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new SoqlBindError('soqlIds requires a non-empty array of Salesforce IDs');
  }
  for (const id of ids) {
    if (!isSalesforceId(id)) {
      throw new SoqlBindError(`Invalid Salesforce ID in list for SOQL bind: '${id}'`);
    }
  }
  return new SafeSoqlFragment(`(${ids.map((id) => `'${id}'`).join(', ')})`);
}

/**
 * Formats a Date or ISO string into a safe SOQL date/datetime literal.
 * Throws `SoqlBindError` if invalid.
 */
export function soqlDate(d: Date | string): SafeSoqlFragment {
  if (d instanceof Date) {
    if (isNaN(d.getTime())) {
      throw new SoqlBindError('Invalid Date object for SOQL bind');
    }
    return new SafeSoqlFragment(d.toISOString());
  }
  if (typeof d === 'string') {
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/.test(d)) {
      return new SafeSoqlFragment(d);
    }
    throw new SoqlBindError(`Invalid date string for SOQL bind: '${d}'`);
  }
  throw new SoqlBindError(`Expected Date or string for SOQL date bind, got ${typeof d}`);
}

/**
 * Wraps a string in single quotes after escaping backslashes and single quotes.
 */
export function soqlString(s: string): SafeSoqlFragment {
  if (typeof s !== 'string') {
    throw new SoqlBindError(`Expected string for SOQL string bind, got ${typeof s}`);
  }
  return new SafeSoqlFragment(`'${escapeSoqlString(s)}'`);
}

/**
 * Marks a string fragment as pre-validated raw SOQL (e.g. static allowlisted field names or operators).
 * Must be used judiciously.
 */
export function soqlRaw(raw: string): SafeSoqlFragment {
  return new SafeSoqlFragment(raw);
}

/**
 * Escapes a value for use inside a SOQL LIKE pattern: quotes and backslashes as for any string,
 * plus `%` and `_`, which LIKE would otherwise treat as wildcards.
 */
export function escapeSoqlLike(val: string): string {
  return escapeSoqlString(val).replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * A quoted LIKE pattern matching `val` literally, with wildcards only where asked for:
 * soqlLike(name, 'contains') gives '%<name>%'.
 */
export function soqlLike(val: string, match: 'contains' | 'startsWith' | 'endsWith' | 'exact' = 'contains'): SafeSoqlFragment {
  if (typeof val !== 'string') {
    throw new SoqlBindError(`Expected string for SOQL LIKE bind, got ${typeof val}`);
  }
  const body = escapeSoqlLike(val);
  const lead = match === 'contains' || match === 'endsWith' ? '%' : '';
  const trail = match === 'contains' || match === 'startsWith' ? '%' : '';
  return new SafeSoqlFragment(`'${lead}${body}${trail}'`);
}

/** True when `text` ends inside an open single-quoted SOQL literal (an odd count of unescaped quotes). */
function insideStringLiteral(text: string): boolean {
  let open = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      i++; // skip the escaped character
    } else if (text[i] === "'") {
      open = !open;
    }
  }
  return open;
}

function formatNumber(val: number): string {
  const text = String(val);
  if (!Number.isFinite(val) || /e/i.test(text)) {
    // SOQL has no exponent notation; 1e21 would be sent as "1e+21" and fail.
    throw new SoqlBindError(`Number not representable in SOQL: ${text}`);
  }
  return text;
}

/**
 * Formats one bound value. Strings are always escaped; outside a literal they are also quoted.
 * Inside a literal the developer has supplied the quotes, so only a string is allowed there.
 * Nothing is inferred from a string's shape: a date-like or Id-like string is still a string.
 */
function formatBindValue(val: unknown, inLiteral: boolean): string {
  if (inLiteral) {
    if (typeof val === 'string') return escapeSoqlString(val);
    throw new SoqlBindError(
      `Only strings can be bound inside a quoted SOQL literal; got ${val instanceof SafeSoqlFragment ? 'a SOQL fragment' : typeof val}. Remove the quotes around the placeholder.`,
    );
  }
  if (val instanceof SafeSoqlFragment) return val.text;
  if (typeof val === 'number') return formatNumber(val);
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) throw new SoqlBindError('Invalid Date for SOQL bind');
    return val.toISOString();
  }
  if (typeof val === 'string') return `'${escapeSoqlString(val)}'`;
  if (Array.isArray(val)) {
    if (val.length === 0) throw new SoqlBindError('Empty array cannot be bound to a SOQL IN clause');
    if (val.every((x) => typeof x === 'string')) return `(${val.map((x) => `'${escapeSoqlString(x)}'`).join(', ')})`;
    if (val.every((x) => typeof x === 'number')) return `(${val.map(formatNumber).join(', ')})`;
    throw new SoqlBindError('Array bind in SOQL must contain only strings or only numbers');
  }
  if (val === null) return 'null';
  // undefined is almost always a missing variable, and binding it as null would silently widen
  // or narrow the query.
  throw new SoqlBindError(`Unsupported value for SOQL bind: ${val === undefined ? 'undefined' : typeof val}`);
}

/**
 * Tagged template literal for building injection-safe SOQL queries.
 *
 * Example:
 * ```ts
 * const query = soql`SELECT Id, Name FROM User WHERE Id = ${userId} AND IsActive = ${true}`;
 * ```
 *
 * Strings are quoted and escaped; Dates become unquoted datetime literals (use soqlDate for a
 * date from a string); arrays become IN lists. A placeholder may also sit inside quotes the
 * template supplies, as in `LIKE '%${x}%'`; the string is then escaped but not re-quoted, and
 * `%` and `_` in it still act as wildcards (use soqlLike to match them literally).
 */
export function soql(strings: TemplateStringsArray, ...values: unknown[]): string {
  let result = '';
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i < values.length) result += formatBindValue(values[i], insideStringLiteral(result));
  }
  if (insideStringLiteral(result)) throw new SoqlBindError('Unterminated string literal in SOQL template');
  return result;
}
