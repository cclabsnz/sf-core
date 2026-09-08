// src/graph/merge.ts
// Fragments in, one canonical graph out. Each producer writes the kinds it owns and neither has
// to run first, so this is where the two halves of an org's picture actually meet.
// See sf-orgviz/docs/CONVERGENCE_SPEC.md section 3.
import type { CanonicalGraph, Coverage, Producer } from './types.js';
import { SUPPORTED_SCHEMA_VERSION } from './types.js';
import { RULES, type Finding } from './rules.js';
import { isKnownKind, ownerOf } from './kinds.js';

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

  const findings: Finding[] = [];

  const orgIds = [...new Set(fragments.map((f) => f.orgId))];
  if (orgIds.length > 1) {
    findings.push({
      code: RULES.MERGE_ORG_MISMATCH,
      id: 'document',
      message: `Fragments describe different orgs: ${orgIds.join(', ')}.`,
      fix: 'Merge fragments captured from one org. Re-run whichever producer targeted the other.',
    });
  }

  const versions = [...new Set(fragments.map((f) => f.schemaVersion))];
  if (versions.length > 1) {
    findings.push({
      code: RULES.MERGE_SCHEMA_VERSION_MISMATCH,
      id: 'document',
      message: `Fragments are at different schema versions: ${versions.join(', ')}.`,
      fix: `Re-produce every fragment with a build that writes ${SUPPORTED_SCHEMA_VERSION}.`,
    });
  }

  const seen = new Map<string, number>();
  for (const [index, f] of fragments.entries()) {
    for (const node of f.nodes) {
      const first = seen.get(node.id);
      if (first !== undefined) {
        findings.push({
          code: RULES.MERGE_ID_COLLISION,
          id: node.id,
          message:
            `Node ${node.id} is claimed by fragment ${first} and fragment ${index}. ` +
            'One node is one fact; two fragments asserting it is two facts wearing one id.',
          fix: 'Give one producer the kind, per KIND_TABLE, and stop the other emitting it.',
        });
      } else {
        seen.set(node.id, index);
      }
    }
  }

  for (const f of fragments) {
    // An unnamed producer cannot violate an ownership rule -- a hand-written or older fragment
    // is still merged, and the id-collision rule above covers the harm ownership prevents.
    if (!f.producer) continue;
    for (const node of f.nodes) {
      if (!isKnownKind(node.kind)) continue;
      const owner = ownerOf(node.kind);
      if (owner === f.producer) continue;
      findings.push({
        code: RULES.MERGE_KIND_NOT_OWNED,
        id: node.id,
        message: `Fragment from ${f.producer} emits kind ${node.kind}, which ${owner} owns.`,
        fix: `Emit ${node.kind} from ${owner}, or move its ownership in KIND_TABLE if the design changed.`,
      });
    }
  }

  if (findings.length > 0) return { graph: null, findings, report };

  // Copied, never mutated: the caller may still be holding the fragments it passed in.
  const nodes = fragments.flatMap((f) => f.nodes).map((n) => ({ ...n, attrs: { ...n.attrs } }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const f of fragments) {
    for (const c of f.contributions ?? []) {
      const target = byId.get(c.nodeId);
      if (!target) {
        findings.push({
          code: RULES.MERGE_CONTRIBUTION_UNRESOLVED,
          id: c.nodeId,
          message:
            `${f.producer ?? 'A fragment'} contributes attributes to ${c.nodeId}, which no ` +
            'fragment provides.',
          fix: 'Include the fragment that owns that node, or stop contributing to it.',
        });
        continue;
      }
      // Namespaced by contributor. An unnamespaced patch makes "who asserted this" unanswerable.
      const ns = f.producer ?? 'unknown';
      target.attrs[ns] = { ...(target.attrs[ns] as object | undefined), ...c.attrs };
      report.contributionsApplied += 1;
    }
  }

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
    nodes,
    edges: fragments.flatMap((f) => f.edges),
    coverage: mergeCoverage(fragments),
  };

  return { graph, findings, report };
}
