// src/graph/rules.ts
// Stable rule codes. A code is an API: renaming one is a breaking change for anything that
// keys off validator output, so treat this table the way you would treat an error enum.

export const RULES = {
  NOT_AN_OBJECT: 'GRAPH_NOT_AN_OBJECT',
  SCHEMA_VERSION_UNSUPPORTED: 'GRAPH_SCHEMA_VERSION_UNSUPPORTED',
  SCHEMA_SHAPE: 'GRAPH_SCHEMA_SHAPE',
  EDGE_MISSING_PROVENANCE: 'GRAPH_EDGE_MISSING_PROVENANCE',
  DERIVED_MISSING_RULE: 'GRAPH_DERIVED_MISSING_RULE',
  ID_NOT_NAMESPACED: 'GRAPH_ID_NOT_NAMESPACED',
  ID_DUPLICATE: 'GRAPH_ID_DUPLICATE',
  UNKNOWN_KIND: 'GRAPH_UNKNOWN_KIND',
  LEVEL_KIND_MISMATCH: 'GRAPH_LEVEL_KIND_MISMATCH',
  LAYER_KIND_MISMATCH: 'GRAPH_LAYER_KIND_MISMATCH',
  ROOT_HAS_PARENT: 'GRAPH_ROOT_HAS_PARENT',
  PARENT_UNRESOLVED: 'GRAPH_PARENT_UNRESOLVED',
  LEVEL_PARENT_ORDER: 'GRAPH_LEVEL_PARENT_ORDER',
  PARENT_CYCLE: 'GRAPH_PARENT_CYCLE',
  EDGE_ENDPOINT_UNRESOLVED: 'GRAPH_EDGE_ENDPOINT_UNRESOLVED',
} as const;

export type RuleCode = (typeof RULES)[keyof typeof RULES];

export interface Finding {
  code: RuleCode;
  /** The offending node id, or `from->to` for an edge. `document` for whole-file findings. */
  id: string;
  message: string;
  /** A supported fix. Never empty — a finding a reader cannot act on is a bug report. */
  fix: string;
}
