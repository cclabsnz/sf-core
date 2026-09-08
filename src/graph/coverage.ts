// src/graph/coverage.ts
// Absence is data: a diagram or a validation report that silently omits a layer nobody was
// allowed to read is a lie. This is the one place that renders `GraphCoverage` to lines of text,
// so every command that reads a graph document reports it the same way. EXTRACT_SPEC section 8.
import type { GraphCoverage } from './types.js';

export function summariseGraphCoverage(coverage: GraphCoverage): string[] {
  const lines: string[] = [];
  for (const note of coverage.notes) lines.push(`  note: ${note}`);
  for (const u of coverage.unavailable) {
    lines.push(`  not read: ${u.scope} (${u.reason}) — ${u.detail}`);
  }
  return lines;
}
