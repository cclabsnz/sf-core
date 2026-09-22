import type { CsvRecord } from './types.js';

/**
 * Split one CSV line-set into rows of fields, honouring quotes.
 *
 * Written by hand rather than taken as a dependency: sf-core ships no runtime deps for this,
 * and the grammar Salesforce emits is small and fixed.
 */
function splitRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      endField();
      i += 1;
      continue;
    }
    if (c === '\r' && text[i + 1] === '\n') {
      endRow();
      i += 2;
      continue;
    }
    if (c === '\n' || c === '\r') {
      endRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }

  // A body with no trailing newline still has a final row to flush.
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * Parse an EventLogFile log body into records keyed by its header row.
 *
 * Returns `[]` for an empty body and for a header-only body. A short row is padded with empty
 * strings rather than shifted, because shifting silently moves a value into the wrong column.
 */
export function parseCsv(text: string): CsvRecord[] {
  if (text.trim() === '') return [];
  const rows = splitRows(text);
  if (rows.length === 0) return [];

  const header = rows[0];
  const out: CsvRecord[] = [];

  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r];
    // A single empty cell is a blank line — but only when the body has more than one column.
    // In a single-column body an empty cell is a legitimate value, not a blank line, and
    // splitRows cannot tell the two apart because it discards quoting.
    if (header.length > 1 && cells.length === 1 && cells[0] === '') continue;
    const rec: Record<string, string> = {};
    for (let c = 0; c < header.length; c += 1) rec[header[c]] = cells[c] ?? '';
    out.push(rec);
  }
  return out;
}
