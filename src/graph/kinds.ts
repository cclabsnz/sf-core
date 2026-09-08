// src/graph/kinds.ts
// The single declaration of what a kind is and how zoomed out it sits.
//
// `level` is stored on every node in the document as well, for legibility — a reader should not
// need this table to filter a graph by hand. That denormalisation is for convenience only:
// the validator asserts the stored value against this table, so this file is the authority.
import type { Layer, Level } from './types.js';

export interface KindEntry {
  layer: Layer;
  level: Level;
}

export const KIND_TABLE = {
  // Level 0 — the coarsest rollup. Deliberately tiny, so "about a dozen nodes" survives an
  // org with forty connected apps. Spec section 2.2.
  org: { layer: 'landscape', level: 0 },
  trustBoundary: { layer: 'landscape', level: 0 },
  rollup: { layer: 'landscape', level: 0 },

  // Level 1 — mined groupings.
  domain: { layer: 'domain', level: 1 },

  // Level 2 — concrete entities.
  connectedApp: { layer: 'landscape', level: 2 },
  namedCredential: { layer: 'landscape', level: 2 },
  integration: { layer: 'landscape', level: 2 },
  sobject: { layer: 'data', level: 2 },
  profile: { layer: 'access', level: 2 },
  permissionSet: { layer: 'access', level: 2 },
  permissionSetGroup: { layer: 'access', level: 2 },
  user: { layer: 'access', level: 2 },
  flow: { layer: 'process', level: 2 },
  apexClass: { layer: 'process', level: 2 },
  trigger: { layer: 'process', level: 2 },
  execution: { layer: 'runtime', level: 2 },

  // Level 3 — members.
  field: { layer: 'data', level: 3 },
  grant: { layer: 'access', level: 3 },
  flowElement: { layer: 'process', level: 3 },
} as const satisfies Record<string, KindEntry>;

export type NodeKind = keyof typeof KIND_TABLE;

export function isKnownKind(kind: string): kind is NodeKind {
  return Object.prototype.hasOwnProperty.call(KIND_TABLE, kind);
}

export function levelOf(kind: NodeKind): Level {
  return KIND_TABLE[kind].level;
}

export function layerOf(kind: NodeKind): Layer {
  return KIND_TABLE[kind].layer;
}
