// src/graph/rules.ts
// Stable rule codes. A code is an API: renaming one is a breaking change for anything that
// keys off validator output, so treat this table the way you would treat an error enum.

export const GRAPH_RULES = {
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
  // Merge. Separate codes from the validator's, because a reader acts differently on them: a
  // validation finding is about one document, a merge finding is about two disagreeing.
  MERGE_ORG_MISMATCH: 'GRAPH_MERGE_ORG_MISMATCH',
  MERGE_SCHEMA_VERSION_MISMATCH: 'GRAPH_MERGE_SCHEMA_VERSION_MISMATCH',
  MERGE_ID_COLLISION: 'GRAPH_MERGE_ID_COLLISION',
  MERGE_KIND_NOT_OWNED: 'GRAPH_MERGE_KIND_NOT_OWNED',
  MERGE_CONTRIBUTION_UNRESOLVED: 'GRAPH_MERGE_CONTRIBUTION_UNRESOLVED',
  MERGE_NO_FRAGMENTS: 'GRAPH_MERGE_NO_FRAGMENTS',
  MERGE_CONTRIBUTION_UNATTRIBUTED: 'GRAPH_MERGE_CONTRIBUTION_UNATTRIBUTED',
} as const;

export type GraphRuleCode = (typeof GRAPH_RULES)[keyof typeof GRAPH_RULES];

export interface GraphDiagnostic {
  code: GraphRuleCode;
  /** The offending node id, or `from->to` for an edge. `document` for whole-file findings. */
  id: string;
  message: string;
  /** A supported fix. Never empty — a finding a reader cannot act on is a bug report. */
  fix: string;
}
