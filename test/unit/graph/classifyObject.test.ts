import { describe, it, expect } from '@jest/globals';
import { classifyObject, type ObjectFacts, type PlatformTargets } from '../../../src/graph/classifyObject.js';

/**
 * Object roles from platform evidence, not names. sf-orgintel docs/OBJECT_ROLES_SPEC.md 2.2.
 * Every fact below is what describeGlobal / EntityDefinition report on a real org; no rule here
 * knows any object by name except through `targets`, which callers read from the system fields.
 */
const targets: PlatformTargets = { actors: new Set(['User', 'Group']), qualifiers: new Set(['RecordType']) };

const entityFacts: ObjectFacts = { layoutable: true, triggerable: true, sharingModel: 'Private' };
const setupFacts: ObjectFacts = { layoutable: false, triggerable: false, sharingModel: 'ReadWrite' };

describe('classifyObject', () => {
  it('folds a Share, History or Feed object into the parent the platform names', () => {
    const d = classifyObject('AccountShare', { ...setupFacts, associateParentEntity: 'Account' }, targets);
    expect(d.role).toBe('companion');
    expect(d.parent).toBe('Account');
    expect(d.evidence).toContain('Account');
  });

  it('keeps an associated object that has layouts and triggers as an entity, like CaseComment', () => {
    expect(classifyObject('CaseComment', { ...entityFacts, associateParentEntity: 'Case' }, targets).role).toBe('entity');
  });

  it('reads the platform-defined suffixes and custom settings', () => {
    expect(classifyObject('Rule__mdt', undefined, targets).role).toBe('configuration');
    expect(classifyObject('Order_Placed__e', undefined, targets).role).toBe('event');
    expect(classifyObject('Ledger__x', undefined, targets).role).toBe('external');
    expect(classifyObject('Org_Defaults__c', { ...setupFacts, customSetting: true }, targets).role).toBe('configuration');
  });

  it('takes actors and qualifiers from the system-field targets the caller read', () => {
    expect(classifyObject('User', { layoutable: true, triggerable: true }, targets).role).toBe('actor');
    expect(classifyObject('Group', setupFacts, targets).role).toBe('actor');
    expect(classifyObject('RecordType', setupFacts, targets).role).toBe('qualifier');
    // Not by name: a different org's targets decide.
    expect(classifyObject('User', entityFacts, { actors: new Set(), qualifiers: new Set() }).role).toBe('entity');
  });

  it('treats an object with no layout and no triggers as platform setup', () => {
    const d = classifyObject('PermissionSetAssignment', setupFacts, targets);
    expect(d.role).toBe('setup');
    expect(d.evidence).toMatch(/layout/);
  });

  it('calls read-only, org-wide-Read data reference data, and only that', () => {
    expect(classifyObject('CodeSet', { ...entityFacts, sharingModel: 'Read', readOnlyInAutomation: true }, targets).role).toBe('reference');
    expect(classifyObject('CodeSet', { ...entityFacts, sharingModel: 'Read', readOnlyInAutomation: false }, targets).role).toBe('entity');
    expect(classifyObject('Case', { ...entityFacts, readOnlyInAutomation: true }, targets).role).toBe('entity');
  });

  it('keeps a ControlledByParent object an entity, and says it is a detail', () => {
    const d = classifyObject('Identifier', { ...entityFacts, sharingModel: 'ControlledByParent' }, targets);
    expect(d.role).toBe('entity');
    expect(d.evidence).toMatch(/parent/i);
  });

  it('is unclassified, not entity, when the platform facts were not read', () => {
    const d = classifyObject('Invoice__c', undefined, targets);
    expect(d.role).toBe('unclassified');
    expect(classifyObject('Invoice__c', { sharingModel: 'Private' }, targets).role).toBe('unclassified');
  });
});
