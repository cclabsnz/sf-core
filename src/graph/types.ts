// src/graph/types.ts
// The canonical graph. Layers are projections over this document; there is no second model.

/** What kind of thing a node is. Independent of `GraphLevel`. Spec section 2. */
export type GraphLayer = 'landscape' | 'domain' | 'data' | 'process' | 'access' | 'runtime';

/** How zoomed out a node is. Independent of `GraphLayer`. Spec section 2.2. */
export type GraphLevel = 0 | 1 | 2 | 3;

/**
 * Which tool emits this kind. Ownership is per kind rather than per layer because
 * sf-orgintel's anatomy collectors gather landscape-layer facts -- sites, products, personas --
 * that sf-orgviz has no reason to extract. Node ids are `prefix.name`, so disjoint kinds give
 * the disjoint ids the merge needs. See sf-orgviz/docs/CONVERGENCE_SPEC.md section 1.1.
 */
export type GraphProducer = 'orgviz' | 'orgintel';

export type GraphProvenanceSource = 'metadata' | 'runtime' | 'derived';

export interface GraphProvenance {
  source: GraphProvenanceSource;
  capturedAt: string;
  /** Required when `source` is 'derived': names the rule that produced this. Spec section 4. */
  rule?: string;
  /** Evidence handle for runtime facts, e.g. an Event Monitoring finding id. */
  evidence?: string;
  observations?: number;
}

export interface GraphNode {
  /** Deterministic and content-derived, namespaced by kind: `obj.Account`. Never an index. */
  id: string;
  kind: string;
  layer: GraphLayer;
  level: GraphLevel;
  /** Null at level 0. Above it, null means extracted but not yet grouped. Spec section 2.3. */
  parent: string | null;
  label: string;
  attrs: Record<string, unknown>;
  provenance: GraphProvenance;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: string;
  attrs: Record<string, unknown>;
  provenance: GraphProvenance;
}

/** Why part of the org is absent from the document. `deferred` was never attempted. */
export interface GraphUnavailable {
  /** Stable dotted key naming what is missing, e.g. `landscape.connectedApps`. */
  scope: string;
  reason: 'deferred' | 'failed';
  detail: string;
}

/**
 * What could not be gathered. Absence is data: a diagram that silently omits a layer nobody was
 * allowed to read is a lie, and `notes` alone is prose a consumer cannot key off.
 */
export interface GraphCoverage {
  notes: string[];
  unavailable: GraphUnavailable[];
}

/**
 * A measurement about a node another producer owns. `recordCount90d` on an `obj.*` node is the
 * case that forced this: it is a fact about a node sf-orgviz owns, measured by sf-orgintel,
 * which has no other reason to emit that node. Applied under the contributor's namespace, never
 * merged into `attrs` directly. See sf-orgviz/docs/CONVERGENCE_SPEC.md section 3.3.
 */
export interface AttributeContribution {
  nodeId: string;
  attrs: Record<string, unknown>;
}

export interface CanonicalGraph {
  schemaVersion: string;
  capturedAt: string;
  orgId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  coverage: GraphCoverage;
  /** Which tool wrote this fragment. Absent on a merged graph, which has no single producer. */
  producer?: GraphProducer;
  contributions?: AttributeContribution[];
}

/**
 * 1.2.0 since `producer` and `contributions` were added, both optional. The 1.0.0 schema set
 * additionalProperties:false, so a 1.1.0 reader rejects a 1.2.0 document — breaking under
 * GRAPH_EXPORT_SPEC section 3, hence the exact-equality check and the bump. No documents exist
 * outside this repo's fixtures (sf-orgviz is unpublished), so the migration is the fixture edit.
 */
export const SUPPORTED_GRAPH_SCHEMA_VERSION = '1.2.0';
