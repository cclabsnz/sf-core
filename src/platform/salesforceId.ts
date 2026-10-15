/**
 * Small facts about how the Salesforce platform actually behaves, learned the hard way by
 * running against real orgs. They live in core so a plugin cannot rediscover them by
 * shipping the bug first.
 */

/**
 * True for a real 15- or 18-character Salesforce Id.
 *
 * Not every Id-shaped field contains one: `FlowDefinitionView.ActiveVersionId` returns a
 * durable name (`ns__Flow-1`) for managed-package flows. Feeding that to a WHERE clause
 * yields `invalid ID field`, once per row.
 */
export function isSalesforceId(value: string): boolean {
  return /^[a-zA-Z0-9]{15}$|^[a-zA-Z0-9]{18}$/.test(value);
}

/**
 * Salesforce error text flattened to a single line and trimmed to fit in a note.
 *
 * Retrieval code must never swallow these. A bare `catch {}` is how `intel map` silently
 * produced an Apex-only graph against a real org for an entire milestone — the operator
 * could not tell a permissions problem from a wrong-API bug.
 */
export function describeSalesforceError(e: unknown, maxLength = 180): string {
  const raw = e instanceof Error ? e.message : String(e);
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength - 3)}…` : oneLine;
}

/**
 * Managed-package Apex bodies come back as the literal string `(hidden)`. Treat that as
 * absent rather than as source — a SymbolTable may still be available for the same class.
 */
export function usableApexBody(body: string | null | undefined): string | null {
  if (!body) return null;
  return body.trim() === '(hidden)' ? null : body;
}

/** `ns__Name` for namespaced components, plain `Name` otherwise. */
export function qualifiedName(name: string, namespacePrefix: string | null | undefined): string {
  return namespacePrefix ? `${namespacePrefix}__${name}` : name;
}

/**
 * Splits Apex source into overlapping windows so a pattern is never run over an unbounded body.
 *
 * This caps the cost of patterns whose backtracking grows polynomially with input length, which
 * on a multi-megabyte generated class can stall an audit. It does NOT make a pattern with
 * exponential backtracking safe: such a pattern can hang on a few dozen characters, and must be
 * rewritten instead.
 *
 * Defaults: 50,000 characters per window, 2,000 characters of overlap.
 */
export function chunkApexBody(body: string, chunkSize = 50_000, overlap = 2_000): string[] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new RangeError(`chunkSize must be a positive integer, got ${chunkSize}`);
  }
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= chunkSize) {
    // An overlap at or above the chunk size would step one character at a time.
    throw new RangeError(`overlap must be an integer from 0 to chunkSize - 1, got ${overlap}`);
  }
  if (!body) return [];
  if (body.length <= chunkSize) return [body];
  const chunks: string[] = [];
  const step = chunkSize - overlap;
  for (let i = 0; i < body.length; i += step) {
    chunks.push(body.slice(i, i + chunkSize));
    if (i + chunkSize >= body.length) break;
  }
  return chunks;
}

/**
 * Whether `regex` matches anywhere in `body`, testing window by window (see chunkApexBody).
 *
 * Only correct for patterns whose matches are at most `overlap` characters long: a longer match
 * that straddles a window boundary is missed. Anchors (`^`, `$`) and `\b` at a window's edge see
 * the edge, not the neighbouring source, so prefer patterns that do not depend on them there.
 * The regex's lastIndex is left at 0.
 */
export function testApexPattern(body: string, regex: RegExp, chunkSize = 50_000, overlap = 2_000): boolean {
  if (!body) return false;
  try {
    for (const chunk of chunkApexBody(body, chunkSize, overlap)) {
      regex.lastIndex = 0;
      if (regex.test(chunk)) return true;
    }
    return false;
  } finally {
    regex.lastIndex = 0;
  }
}
