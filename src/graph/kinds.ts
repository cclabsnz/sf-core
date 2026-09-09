// src/graph/kinds.ts
// The single declaration of what a kind is and how zoomed out it sits.
//
// `level` is stored on every node in the document as well, for legibility — a reader should not
// need this table to filter a graph by hand. That denormalisation is for convenience only:
// the validator asserts the stored value against this table, so this file is the authority.
import type { GraphLayer, GraphLevel, GraphProducer } from './types.js';

export interface GraphKindEntry {
  layer: GraphLayer;
  level: GraphLevel;
  owner: GraphProducer;
}

export const GRAPH_KIND_TABLE = {
  // Level 0 — the coarsest rollup. Deliberately tiny, so "about a dozen nodes" survives an
  // org with forty connected apps. Spec section 2.2.
  org: { layer: 'landscape', level: 0, owner: 'orgviz' },
  trustBoundary: { layer: 'landscape', level: 0, owner: 'orgviz' },
  rollup: { layer: 'landscape', level: 0, owner: 'orgviz' },

  // Level 1 — mined groupings.
  domain: { layer: 'domain', level: 1, owner: 'orgviz' },

  // Level 2 — concrete entities.
  connectedApp: { layer: 'landscape', level: 2, owner: 'orgviz' },
  namedCredential: { layer: 'landscape', level: 2, owner: 'orgviz' },
  integration: { layer: 'landscape', level: 2, owner: 'orgviz' },
  site: { layer: 'landscape', level: 2, owner: 'orgintel' },
  product: { layer: 'landscape', level: 2, owner: 'orgintel' },
  ssoConfig: { layer: 'landscape', level: 2, owner: 'orgintel' },
  sobject: { layer: 'data', level: 2, owner: 'orgviz' },
  profile: { layer: 'access', level: 2, owner: 'orgviz' },
  permissionSet: { layer: 'access', level: 2, owner: 'orgviz' },
  permissionSetGroup: { layer: 'access', level: 2, owner: 'orgviz' },
  user: { layer: 'access', level: 2, owner: 'orgviz' },
  flow: { layer: 'process', level: 2, owner: 'orgintel' },
  apexClass: { layer: 'process', level: 2, owner: 'orgintel' },
  trigger: { layer: 'process', level: 2, owner: 'orgintel' },
  execution: { layer: 'runtime', level: 2, owner: 'orgintel' },

  // Level 3 — members.
  field: { layer: 'data', level: 3, owner: 'orgviz' },
  grant: { layer: 'access', level: 3, owner: 'orgviz' },
  flowElement: { layer: 'process', level: 3, owner: 'orgintel' },
} as const satisfies Record<string, GraphKindEntry>;

export type GraphNodeKind = keyof typeof GRAPH_KIND_TABLE;

export function isKnownGraphKind(kind: string): kind is GraphNodeKind {
  return Object.prototype.hasOwnProperty.call(GRAPH_KIND_TABLE, kind);
}

export function levelOfKind(kind: GraphNodeKind): GraphLevel {
  return GRAPH_KIND_TABLE[kind].level;
}

export function layerOfKind(kind: GraphNodeKind): GraphLayer {
  return GRAPH_KIND_TABLE[kind].layer;
}

export function ownerOfKind(kind: GraphNodeKind): GraphProducer {
  return GRAPH_KIND_TABLE[kind].owner;
}
