// src/graph/kinds.ts
// The single declaration of what a kind is and how zoomed out it sits.
//
// `level` is stored on every node in the document as well, for legibility — a reader should not
// need this table to filter a graph by hand. That denormalisation is for convenience only:
// the validator asserts the stored value against this table, so this file is the authority.
import type { Layer, Level, Producer } from './types.js';

export interface KindEntry {
  layer: Layer;
  level: Level;
  owner: Producer;
}

export const KIND_TABLE = {
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

export function ownerOf(kind: NodeKind): Producer {
  return KIND_TABLE[kind].owner;
}
