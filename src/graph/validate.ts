// src/graph/validate.ts
// Runs before any renderer touches a document. Returns findings; never throws, never renders
// partially. Spec section 5.
import { Ajv, type ErrorObject } from 'ajv';
import { GRAPH_SCHEMA } from './schema.js';
import { GRAPH_RULES, type GraphDiagnostic } from './rules.js';
import { SUPPORTED_GRAPH_SCHEMA_VERSION, type CanonicalGraph, type GraphNode } from './types.js';
import { isKnownGraphKind, levelOfKind, layerOfKind } from './kinds.js';
import { codepointCompare } from '../lib/order.js';

// ajv exports the class as a named export alongside the default, and the named one is what
// survives the CommonJS-to-NodeNext boundary as a constructable value.
// `allErrors: true` is deliberate, and the risk Semgrep's ajv-allerrors-true rule guards against
// does not reach it. That rule is about unbounded error allocation: a schema containing `anyOf`,
// `oneOf`, `allOf`, `not` or `patternProperties` can make an attacker's input produce errors
// combinatorially. GRAPH_SCHEMA contains none of those keywords, its six `$ref`s point at flat
// non-recursive `$defs`, and the schema is a constant in this package — only the document varies,
// so error count is bounded linearly by the document's own size.
//
// It is also load-bearing. This validator's contract is that one run reports every problem with
// its rule code, the offending id and a fix, so an operator repairs a graph in one pass. Stopping
// at the first error would report one problem per run against documents that routinely carry
// thousands of nodes.
// nosemgrep: javascript.ajv.security.audit.ajv-allerrors-true
const ajv = new Ajv({ allErrors: true, strict: false });
const validateShape = ajv.compile(GRAPH_SCHEMA);

/** Edge identity used in findings, so a reader can locate the offending edge in the file. */
export function graphEdgeId(e: { from: string; to: string }): string {
  return `${e.from}->${e.to}`;
}

export function validateGraph(doc: unknown): GraphDiagnostic[] {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return [
      {
        code: GRAPH_RULES.NOT_AN_OBJECT,
        id: 'document',
        message: 'The graph document is not a JSON object.',
        fix: 'Pass the path to a canonical graph document written by this tool.',
      },
    ];
  }

  const candidate = doc as Partial<CanonicalGraph>;

  if (candidate.schemaVersion !== SUPPORTED_GRAPH_SCHEMA_VERSION) {
    // Loud, not partial: a document from another schema version is not partially loadable,
    // because the fields that changed are exactly the ones a reader would misread.
    return [
      {
        code: GRAPH_RULES.SCHEMA_VERSION_UNSUPPORTED,
        id: 'document',
        message:
          `schemaVersion is ${String(candidate.schemaVersion)}; this build supports ` +
          `${SUPPORTED_GRAPH_SCHEMA_VERSION}.`,
        // Re-extraction is the only remedy, so it is the only one offered. This previously also
        // promised a migration, which was never written -- and the promise went unnoticed because
        // the finding was unreachable until the schema version first moved.
        fix: `Re-extract the graph with a build that writes ${SUPPORTED_GRAPH_SCHEMA_VERSION}. There is no in-place migration between schema versions.`,
      },
    ];
  }

  if (!validateShape(doc)) {
    // A missing edge provenance is reported under its own code rather than as a generic shape
    // error, because it is the one shape failure that has a specific remedy and because
    // consumers key off the code.
    const g = doc as { edges?: Array<{ from?: string; to?: string; provenance?: unknown }> };
    const provenanceFindings: GraphDiagnostic[] = (g.edges ?? [])
      .filter((e) => e !== null && typeof e === 'object' && e.provenance === undefined)
      .map((e) => ({
        code: GRAPH_RULES.EDGE_MISSING_PROVENANCE,
        id: graphEdgeId({ from: String(e.from), to: String(e.to) }),
        message: 'Edge carries no provenance.',
        fix: "Add provenance with source 'metadata', 'runtime' or 'derived'.",
      }));
    if (provenanceFindings.length > 0) return provenanceFindings;

    return (validateShape.errors ?? []).map((e: ErrorObject) => ({
      code: GRAPH_RULES.SCHEMA_SHAPE,
      id: e.instancePath || 'document',
      message: `${e.instancePath || 'document'} ${e.message ?? 'failed schema validation'}.`,
      fix: 'Correct the field named in the path so it matches the documented shape.',
    }));
  }

  // ajv's compiled function is a type guard, so `doc` is narrowed to its own inferred shape
  // here rather than to ours. The double assertion is deliberate: the schema is what makes the
  // claim true, and it has just run.
  const graph = doc as unknown as CanonicalGraph;
  return semanticFindings(graph);
}

/**
 * Cross-referencing rules JSON Schema cannot express. Findings are accumulated rather than
 * short-circuited: a reader fixing a document wants the whole list, not one error per run.
 * Sorted by id then code so two runs over the same document report identically.
 */
function semanticFindings(graph: CanonicalGraph): GraphDiagnostic[] {
  const findings: GraphDiagnostic[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  const seen = new Set<string>();
  for (const n of graph.nodes) {
    if (seen.has(n.id)) {
      findings.push({
        code: GRAPH_RULES.ID_DUPLICATE, id: n.id,
        message: `Duplicate node id ${n.id}.`,
        fix: 'Node ids are content-derived and unique. Two nodes derived the same id — namespace them by kind.',
      });
    }
    seen.add(n.id);

    if (!n.id.includes('.')) {
      findings.push({
        code: GRAPH_RULES.ID_NOT_NAMESPACED, id: n.id,
        message: `Node id ${n.id} is not namespaced by kind.`,
        fix: 'Prefix the id with its kind namespace, for example obj.Account or permset.Sales_Ops.',
      });
    }

    if (!isKnownGraphKind(n.kind)) {
      findings.push({
        code: GRAPH_RULES.UNKNOWN_KIND, id: n.id,
        message: `Unknown kind ${n.kind}.`,
        fix: 'Add the kind to GRAPH_KIND_TABLE in src/graph/kinds.ts with its layer and level, or correct the node.',
      });
    } else {
      if (n.level !== levelOfKind(n.kind)) {
        findings.push({
          code: GRAPH_RULES.LEVEL_KIND_MISMATCH, id: n.id,
          message: `Node ${n.id} stores level ${n.level}; kind ${n.kind} is level ${levelOfKind(n.kind)}.`,
          fix: `Set level to ${levelOfKind(n.kind)}. Level is a pure function of kind; the stored value is a convenience copy.`,
        });
      }
      if (n.layer !== layerOfKind(n.kind)) {
        findings.push({
          code: GRAPH_RULES.LAYER_KIND_MISMATCH, id: n.id,
          message: `Node ${n.id} stores layer ${n.layer}; kind ${n.kind} is layer ${layerOfKind(n.kind)}.`,
          fix: `Set layer to ${layerOfKind(n.kind)}.`,
        });
      }
    }

    if (n.level === 0 && n.parent !== null) {
      findings.push({
        code: GRAPH_RULES.ROOT_HAS_PARENT, id: n.id,
        message: `Level 0 node ${n.id} carries a parent.`,
        fix: 'Set parent to null. Level 0 is the root of the containment tree.',
      });
    }

    // A null parent above level 0 is deliberately not a finding. It means extracted but not
    // grouped, and the selector reports it as unattributed. Spec section 2.3.
    if (n.parent !== null) {
      const parent = byId.get(n.parent);
      if (!parent) {
        findings.push({
          code: GRAPH_RULES.PARENT_UNRESOLVED, id: n.id,
          message: `Parent ${n.parent} of ${n.id} is not in the document.`,
          fix: 'Add the parent node, or set parent to null to report this node as unattributed.',
        });
      } else if (parent.level >= n.level) {
        findings.push({
          code: GRAPH_RULES.LEVEL_PARENT_ORDER, id: n.id,
          message: `Parent ${parent.id} is level ${parent.level}; child ${n.id} is level ${n.level}.`,
          fix: 'A parent must sit at a strictly lower level than its child.',
        });
      }
    }
  }

  for (const n of graph.nodes) {
    if (inCycle(n.id, byId)) {
      findings.push({
        code: GRAPH_RULES.PARENT_CYCLE, id: n.id,
        message: `Node ${n.id} is part of a parent cycle.`,
        fix: 'Break the cycle: containment must be a tree rooted at a level 0 node.',
      });
    }
  }

  for (const e of graph.edges) {
    const id = graphEdgeId(e);
    if (e.provenance.source === 'derived' && !e.provenance.rule) {
      findings.push({
        code: GRAPH_RULES.DERIVED_MISSING_RULE, id,
        message: 'Derived edge does not name the rule that produced it.',
        fix: 'Set provenance.rule to the identifier of the aggregation rule.',
      });
    }
    for (const endpoint of [e.from, e.to]) {
      if (!byId.has(endpoint)) {
        findings.push({
          code: GRAPH_RULES.EDGE_ENDPOINT_UNRESOLVED, id,
          message: `Edge endpoint ${endpoint} is not in the document.`,
          fix: 'Add the missing node, or remove the edge.',
        });
      }
    }
  }

  return findings.sort((a, b) => codepointCompare(a.id, b.id) || codepointCompare(a.code, b.code));
}

/** Walks the parent chain with a visited set, so a cycle terminates instead of hanging. */
function inCycle(start: string, byId: Map<string, GraphNode>): boolean {
  const visited = new Set<string>();
  let current: string | null = start;
  while (current !== null) {
    if (visited.has(current)) return true;
    visited.add(current);
    current = byId.get(current)?.parent ?? null;
  }
  return false;
}
