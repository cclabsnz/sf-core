// src/graph/merge.ts
// Fragments in, one canonical graph out. Each producer writes the kinds it owns and neither has
// to run first, so this is where the two halves of an org's picture actually meet.
// See sf-orgviz/docs/CONVERGENCE_SPEC.md section 3.
import type { CanonicalGraph, Coverage, Producer } from './types.js';
import type { Finding } from './rules.js';

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
  const report: MergeReport = {
    fragments: fragments.map((f) => ({ producer: f.producer ?? null, capturedAt: f.capturedAt })),
    contributionsApplied: 0,
  };

  // The oldest, not the newest. A merged picture is only as fresh as its stalest part, and
  // taking the newest would let a fresh fragment make a month-old one look current.
  const capturedAt = fragments
    .map((f) => f.capturedAt)
    .reduce((oldest, t) => (t < oldest ? t : oldest));

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
