// src/graph/types.ts
// The canonical graph. Layers are projections over this document; there is no second model.

/** What kind of thing a node is. Independent of `Level`. Spec section 2. */
export type Layer = 'landscape' | 'domain' | 'data' | 'process' | 'access' | 'runtime';

/** How zoomed out a node is. Independent of `Layer`. Spec section 2.2. */
export type Level = 0 | 1 | 2 | 3;

export type ProvenanceSource = 'metadata' | 'runtime' | 'derived';

export interface Provenance {
  source: ProvenanceSource;
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
  layer: Layer;
  level: Level;
  /** Null at level 0. Above it, null means extracted but not yet grouped. Spec section 2.3. */
  parent: string | null;
  label: string;
  attrs: Record<string, unknown>;
  provenance: Provenance;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: string;
  attrs: Record<string, unknown>;
  provenance: Provenance;
}

/** Why part of the org is absent from the document. `deferred` was never attempted. */
export interface Unavailable {
  /** Stable dotted key naming what is missing, e.g. `landscape.connectedApps`. */
  scope: string;
  reason: 'deferred' | 'failed';
  detail: string;
}

/**
 * What could not be gathered. Absence is data: a diagram that silently omits a layer nobody was
 * allowed to read is a lie, and `notes` alone is prose a consumer cannot key off.
 */
export interface Coverage {
  notes: string[];
  unavailable: Unavailable[];
}

export interface CanonicalGraph {
  schemaVersion: string;
  capturedAt: string;
  orgId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  coverage: Coverage;
}

/**
 * 1.1.0 since `coverage` was added. The 1.0.0 schema set additionalProperties:false, so a 1.0.0
 * reader rejects a 1.1.0 document — breaking under GRAPH_EXPORT_SPEC section 3, hence the bump.
 * No 1.0.0 documents exist outside the test fixture, so the migration is the fixture edit.
 */
export const SUPPORTED_SCHEMA_VERSION = '1.1.0';
