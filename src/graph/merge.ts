// src/graph/merge.ts
// Fragments in, one canonical graph out. Each producer writes the kinds it owns and neither has
// to run first, so this is where the two halves of an org's picture actually meet.
// See sf-orgviz/docs/CONVERGENCE_SPEC.md section 3.
import type { CanonicalGraph, Coverage, Producer } from './types.js';
import { SUPPORTED_SCHEMA_VERSION } from './types.js';
import { RULES, type Finding } from './rules.js';
import { isKnownKind, ownerOf } from './kinds.js';
import { codepointCompare } from '../lib/order.js';

export interface FragmentCapture {
  producer: Producer | null;
  capturedAt: string;
}

export interface MergeReport {
  fragments: FragmentCapture[];
  contributionsApplied: number;
}

export interface MergeResult {
  /**
   * Null if and only if one of the four rejections fired: org mismatch, schema version mismatch
   * (including a merged document that would carry an unsupported version), id collision, or kind
   * not owned. An unresolved or unattributed contribution is a different class of thing -- the
   * same class as a dangling edge endpoint, which this design also reports rather than treats as
   * fatal -- so it comes back as a finding alongside a non-null graph, never in place of one.
   */
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

/** Sorted the same way regardless of the order the caller passed fragments in. Spec section 12. */
function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort(
    (a, b) => codepointCompare(a.code, b.code) || codepointCompare(a.id, b.id),
  );
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
  } else if (versions[0] !== SUPPORTED_SCHEMA_VERSION) {
    // Every fragment agrees with every other, so the mismatch rule above never fires -- but they
    // can all agree on a version this build no longer supports. Two fragments from a pre-bump
    // build are the day-one case: they merge clean and the operator would otherwise only learn
    // about it from a finding naming the merged OUTPUT, not the stale input that caused it.
    findings.push({
      code: RULES.MERGE_SCHEMA_VERSION_MISMATCH,
      id: 'document',
      message: `Fragments agree on schema version ${versions[0]}, which this build does not support.`,
      fix: `Re-produce every fragment with a build that writes ${SUPPORTED_SCHEMA_VERSION}.`,
    });
  }

  const seen = new Map<string, number>();
  for (const [index, f] of fragments.entries()) {
    for (const node of f.nodes) {
      const first = seen.get(node.id);
      if (first !== undefined) {
        const message =
          first === index
            ? `Node ${node.id} is claimed twice within fragment ${index + 1}. ` +
              'One node is one fact; two fragments asserting it is two facts wearing one id.'
            : `Node ${node.id} is claimed by fragment ${first + 1} and fragment ${index + 1}. ` +
              'One node is one fact; two fragments asserting it is two facts wearing one id.';
        findings.push({
          code: RULES.MERGE_ID_COLLISION,
          id: node.id,
          message,
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

  if (findings.length > 0) return { graph: null, findings: sortFindings(findings), report };

  // Copied, never mutated: the caller may still be holding the fragments it passed in.
  const nodes = fragments.flatMap((f) => f.nodes).map((n) => ({ ...n, attrs: { ...n.attrs } }));
  const edges = fragments.flatMap((f) => f.edges).map((e) => ({ ...e, attrs: { ...e.attrs } }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const f of fragments) {
    for (const c of f.contributions ?? []) {
      if (!f.producer) {
        // Namespaced by contributor: an unnamespaced patch makes "who asserted this"
        // unanswerable, and two anonymous fragments contributing the same key would be a silent
        // last-writer-wins -- exactly what namespacing exists to prevent. Skipped, not merged
        // under a shared 'unknown' bucket.
        findings.push({
          code: RULES.MERGE_CONTRIBUTION_UNATTRIBUTED,
          id: c.nodeId,
          message:
            `A fragment with no producer contributes attributes to ${c.nodeId}. An unattributed ` +
            'contribution cannot be namespaced, so it was not applied.',
          fix: 'Set `producer` on the fragment that contributes attributes, or drop the contribution.',
        });
        continue;
      }
      const target = byId.get(c.nodeId);
      if (!target) {
        findings.push({
          code: RULES.MERGE_CONTRIBUTION_UNRESOLVED,
          id: c.nodeId,
          message: `${f.producer} contributes attributes to ${c.nodeId}, which no fragment provides.`,
          fix: 'Include the fragment that owns that node, or stop contributing to it.',
        });
        continue;
      }
      const ns = f.producer;
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
  // silently rewrite the caller's format. `Date.parse` returns NaN on an unparseable string, and
  // NaN comparisons are always false, so an unguarded reduce lets a bad value at index 0 always
  // win and a bad value elsewhere always lose, silently. A parseable timestamp is preferred over
  // an unparseable one; only when every fragment is unparseable does the first one's string win.
  const capturedAt = fragments.map((f) => f.capturedAt).reduce((oldest, t) => {
    const oldestParsed = Date.parse(oldest);
    const tParsed = Date.parse(t);
    if (Number.isNaN(oldestParsed)) return Number.isNaN(tParsed) ? oldest : t;
    if (Number.isNaN(tParsed)) return oldest;
    return tParsed < oldestParsed ? t : oldest;
  });

  const graph: CanonicalGraph = {
    schemaVersion: fragments[0].schemaVersion,
    capturedAt,
    orgId: fragments[0].orgId,
    nodes: nodes.sort((a, b) => codepointCompare(a.id, b.id)),
    edges: edges.sort(
      (a, b) =>
        codepointCompare(a.from, b.from) ||
        codepointCompare(a.to, b.to) ||
        codepointCompare(a.kind, b.kind) ||
        codepointCompare(a.provenance.source, b.provenance.source),
    ),
    coverage: mergeCoverage(fragments),
  };

  return { graph, findings: sortFindings(findings), report };
}
