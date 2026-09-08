// src/graph/merge.ts
// Fragments in, one canonical graph out. Each producer writes the kinds it owns and neither has
// to run first, so this is where the two halves of an org's picture actually meet.
// See sf-orgviz/docs/CONVERGENCE_SPEC.md section 3.
import type { CanonicalGraph, Coverage, Producer } from './types.js';
import { RULES, type Finding } from './rules.js';

export interface FragmentCapture {
  producer: Producer | null;
  capturedAt: string;
}

export interface MergeReport {
  fragments: FragmentCapture[];
  contributionsApplied: number;
}

export interface MergeResult {
  /** Null when `findings` contains a rejection: a partial merge is worse than none. */
  graph: CanonicalGraph | null;
  findings: Finding[];
  report: MergeReport;
}

function mergeCoverage(fragments: CanonicalGraph[]): Coverage {
  return {
    notes: fragments.flatMap((f) => f.coverage.notes),
    unavailable: fragments.flatMap((f) => f.coverage.unavailable),
  };
}

export function mergeGraphs(fragments: CanonicalGraph[]): MergeResult {
  if (fragments.length === 0) {
    return {
      graph: null,
      findings: [
        {
          code: RULES.MERGE_NO_FRAGMENTS,
          id: 'document',
          message: 'No fragments were supplied to merge.',
          fix: 'Pass at least one canonical graph fragment to merge.',
        },
      ],
      report: { fragments: [], contributionsApplied: 0 },
    };
  }

  const report: MergeReport = {
    fragments: fragments.map((f) => ({ producer: f.producer ?? null, capturedAt: f.capturedAt })),
    contributionsApplied: 0,
  };

  // The oldest, not the newest. A merged picture is only as fresh as its stalest part, and
  // taking the newest would let a fresh fragment make a month-old one look current. Compare
  // chronologically, not lexically: two independently-written tools are not guaranteed to agree
  // on timezone offset or fractional-second precision, and a lexical `<` gets those wrong (e.g.
  // '...+05:00' can sort after a numerically earlier '...Z' instant). The ORIGINAL string is
  // kept as the value -- never round-tripped through a Date and re-serialised, which would
  // silently rewrite the caller's format.
  const capturedAt = fragments
    .map((f) => f.capturedAt)
    .reduce((oldest, t) => (Date.parse(t) < Date.parse(oldest) ? t : oldest));

  const graph: CanonicalGraph = {
    schemaVersion: fragments[0].schemaVersion,
    capturedAt,
    orgId: fragments[0].orgId,
    nodes: fragments.flatMap((f) => f.nodes),
    edges: fragments.flatMap((f) => f.edges),
    coverage: mergeCoverage(fragments),
  };

  const findings: Finding[] = [];

  return { graph, findings, report };
}
