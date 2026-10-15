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
 * Formats a bind value safely based on its type and surrounding template quotation.
 */
function formatBindValue(val: unknown, precedingChunk: string, followingChunk: string): string {
  if (val instanceof SafeSoqlFragment) {
    return val.text;
  }

  // Number: must be finite
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      throw new SoqlBindError(`Invalid number for SOQL bind: ${val}`);
    }
    return String(val);
  }

  // Boolean
  if (typeof val === 'boolean') {
    return val ? 'true' : 'false';
  }

  // Date
  if (val instanceof Date) {
    if (isNaN(val.getTime())) {
      throw new SoqlBindError('Invalid Date for SOQL bind');
    }
    return val.toISOString();
  }

  // Array of Salesforce IDs or primitives
  if (Array.isArray(val)) {
    if (val.length === 0) {
      throw new SoqlBindError('Empty array cannot be bound to SOQL IN clause');
    }
    if (val.every((x) => typeof x === 'string' && isSalesforceId(x))) {
      return `(${val.map((x) => `'${x}'`).join(', ')})`;
    }
    if (val.every((x) => typeof x === 'number' && Number.isFinite(x))) {
      return `(${val.join(', ')})`;
    }
    if (val.every((x) => typeof x === 'string')) {
      return `(${val.map((x) => `'${escapeSoqlString(x)}'`).join(', ')})`;
    }
    throw new SoqlBindError('Array bind in SOQL must contain only strings, numbers, or Salesforce IDs');
  }

  // String value
  if (typeof val === 'string') {
    const isQuoted = precedingChunk.endsWith("'") && followingChunk.startsWith("'");

    if (isSalesforceId(val)) {
      return isQuoted ? val : `'${val}'`;
    }

    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/.test(val)) {
      return isQuoted ? val : val;
    }

    const escaped = escapeSoqlString(val);
    return isQuoted ? escaped : `'${escaped}'`;
  }

  if (val === null || val === undefined) {
    return 'null';
  }

  throw new SoqlBindError(`Unsupported value type for SOQL bind: ${typeof val}`);
}

/**
 * Tagged template literal for building injection-safe SOQL queries.
 *
 * Example:
 * ```ts
 * const query = soql`SELECT Id, Name FROM User WHERE Id = ${userId} AND IsActive = ${true}`;
 * ```
 */
export function soql(strings: TemplateStringsArray, ...values: unknown[]): string {
  let result = '';
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i < values.length) {
      const preceding = strings[i];
      const following = strings[i + 1] ?? '';
      result += formatBindValue(values[i], preceding, following);
    }
  }
  return result;
}
