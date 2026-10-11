/**
 * Object roles from platform evidence, not names. Specified in sf-orgintel
 * `docs/OBJECT_ROLES_SPEC.md` section 2.2.
 *
 * `roleOf` recognised about 45 objects by name and called everything else business, so on a real
 * Health Cloud org `User` and `RecordType` ranked among the most-coupled objects, `AccountShare`
 * stood beside `Account` as a peer, and industry objects landed in whichever bucket their names
 * happened to fit. This classifier asks the platform instead: what `describeGlobal` and
 * `EntityDefinition` report about every object on every org, what the system fields point at, and
 * how production automation uses the object. No rule here knows an object by name; the only names
 * are the ones the caller read from the system fields' `referenceTo`.
 *
 * Every decision carries the evidence that made it, and an object whose facts were not read is
 * `unclassified` rather than defaulted, the same rule as the rest of this codebase: a guess must
 * not read as a measurement.
 */

export type ObjectRole =
  /** Business data: a record a process is about. */
  | 'entity'
  /** A Share, History or Feed-style object that belongs to a parent, folded into it. */
  | 'companion'
  /** Who owns, creates or changes records: the targets of OwnerId, CreatedById, LastModifiedById. */
  | 'actor'
  /** Which variant of another object a record is: the target of RecordTypeId. */
  | 'qualifier'
  /** Platform setup: an object that can have neither a page layout nor an Apex trigger. */
  | 'setup'
  /** Custom metadata and custom settings: configuration read by behaviour. */
  | 'configuration'
  /** Platform events. */
  | 'event'
  /** External objects. */
  | 'external'
  /** Data production automation only ever reads, shared org-wide as read-only. */
  | 'reference'
  /** The facts that would decide it were not read. */
  | 'unclassified';

/**
 * What the platform reports about one object. Every field is optional because each comes from a
 * read that can be refused; an absent field means "not read", never "false".
 */
export interface ObjectFacts {
  /** `describeGlobal` `associateParentEntity`: the object a Share, History, Feed and so on belongs to. */
  associateParentEntity?: string | null;
  /** `EntityDefinition.IsLayoutable` or `describe` `layoutable`. */
  layoutable?: boolean | null;
  /** `EntityDefinition.IsApexTriggerable` or `describe` `triggerable`. */
  triggerable?: boolean | null;
  /** `describe` `customSetting`. */
  customSetting?: boolean | null;
  /** `EntityDefinition.InternalSharingModel`, e.g. `Private`, `Read`, `ControlledByParent`. */
  sharingModel?: string | null;
  /** True when production automation touches the object and only ever reads it. */
  readOnlyInAutomation?: boolean | null;
}

/** The objects the platform's system fields point at, read from `describe`'s `referenceTo`. */
export interface PlatformTargets {
  /** Targets of `OwnerId`, `CreatedById` and `LastModifiedById`. */
  actors: ReadonlySet<string>;
  /** Targets of `RecordTypeId`. */
  qualifiers: ReadonlySet<string>;
}

export interface ObjectRoleDecision {
  role: ObjectRole;
  /** The fact that decided the role, in words a reviewer can check. */
  evidence: string;
  /** For a companion, the object it folds into. */
  parent?: string;
}

/** API-name suffixes the platform defines, so they count as evidence rather than convention. */
const SUFFIX_ROLES: ReadonlyArray<readonly [string, ObjectRole, string]> = [
  ['__mdt', 'configuration', 'custom metadata type (__mdt)'],
  ['__e', 'event', 'platform event (__e)'],
  ['__x', 'external', 'external object (__x)'],
];

/** First matching rule wins, in the order OBJECT_ROLES_SPEC 2.2 lists them. */
export function classifyObject(
  name: string,
  facts: ObjectFacts | undefined,
  targets: PlatformTargets,
): ObjectRoleDecision {
  const f = facts ?? {};
  const noLayoutNoTriggers = f.layoutable === false && f.triggerable === false;

  // A parent alone is not enough: the platform also gives CaseComment a parent, and CaseComment
  // is layout-able, triggerable business data.
  if (f.associateParentEntity && noLayoutNoTriggers) {
    return {
      role: 'companion',
      parent: f.associateParentEntity,
      evidence: `the platform names ${f.associateParentEntity} as its parent, and it has no layout or triggers`,
    };
  }
  for (const [suffix, role, what] of SUFFIX_ROLES) {
    if (name.endsWith(suffix)) return { role, evidence: what };
  }
  if (f.customSetting) return { role: 'configuration', evidence: 'custom setting' };
  if (targets.actors.has(name)) {
    return { role: 'actor', evidence: 'target of the OwnerId, CreatedById or LastModifiedById system fields' };
  }
  if (targets.qualifiers.has(name)) return { role: 'qualifier', evidence: 'target of the RecordTypeId system field' };
  if (noLayoutNoTriggers) return { role: 'setup', evidence: 'can have neither a page layout nor an Apex trigger' };

  // Everything below needs the capability facts. Without them the object is not known to be
  // business data, and saying so beats defaulting it there.
  if (f.layoutable == null || f.triggerable == null) {
    return { role: 'unclassified', evidence: 'its layout and trigger capability were not read' };
  }
  if (f.readOnlyInAutomation === true && f.sharingModel === 'Read') {
    return { role: 'reference', evidence: 'production automation only reads it, and its org-wide default is Read' };
  }
  if (f.sharingModel === 'ControlledByParent') {
    return { role: 'entity', evidence: 'business data; a detail of its parent (sharing ControlledByParent)' };
  }
  return { role: 'entity', evidence: 'business data: can have a page layout and Apex triggers' };
}
