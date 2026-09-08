// src/graph/schema.ts
// JSON Schema for the document envelope and the shape of nodes and edges. Semantic rules that
// need cross-referencing between nodes (parents, cycles, endpoints) live in validate.ts, since
// JSON Schema cannot express them.

export const GRAPH_SCHEMA = {
  type: 'object',
  required: ['schemaVersion', 'capturedAt', 'orgId', 'nodes', 'edges', 'coverage'],
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'string' },
    capturedAt: { type: 'string' },
    orgId: { type: 'string' },
    nodes: { type: 'array', items: { $ref: '#/$defs/node' } },
    edges: { type: 'array', items: { $ref: '#/$defs/edge' } },
    coverage: { $ref: '#/$defs/coverage' },
  },
  $defs: {
    provenance: {
      type: 'object',
      required: ['source', 'capturedAt'],
      additionalProperties: false,
      properties: {
        source: { enum: ['metadata', 'runtime', 'derived'] },
        capturedAt: { type: 'string' },
        rule: { type: 'string' },
        evidence: { type: 'string' },
        observations: { type: 'number' },
      },
    },
    node: {
      type: 'object',
      required: ['id', 'kind', 'layer', 'level', 'parent', 'label', 'attrs', 'provenance'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        kind: { type: 'string', minLength: 1 },
        layer: { enum: ['landscape', 'domain', 'data', 'process', 'access', 'runtime'] },
        level: { enum: [0, 1, 2, 3] },
        parent: { type: ['string', 'null'] },
        label: { type: 'string' },
        attrs: { type: 'object' },
        provenance: { $ref: '#/$defs/provenance' },
      },
    },
    edge: {
      type: 'object',
      required: ['from', 'to', 'kind', 'attrs', 'provenance'],
      additionalProperties: false,
      properties: {
        from: { type: 'string', minLength: 1 },
        to: { type: 'string', minLength: 1 },
        kind: { type: 'string', minLength: 1 },
        attrs: { type: 'object' },
        provenance: { $ref: '#/$defs/provenance' },
      },
    },
    coverage: {
      type: 'object',
      required: ['notes', 'unavailable'],
      additionalProperties: false,
      properties: {
        notes: { type: 'array', items: { type: 'string' } },
        unavailable: {
          type: 'array',
          items: {
            type: 'object',
            required: ['scope', 'reason', 'detail'],
            additionalProperties: false,
            properties: {
              scope: { type: 'string', minLength: 1 },
              reason: { enum: ['deferred', 'failed'] },
              detail: { type: 'string' },
            },
          },
        },
      },
    },
  },
};
