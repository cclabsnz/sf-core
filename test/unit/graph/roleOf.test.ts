// test/unit/graph/roleOf.test.ts
// The classifier is a pure function of the object name, which is why it lands as attrs.role at
// extraction time rather than travelling as a measurement. See CONVERGENCE_SPEC.md section 3.3.
import { describe, it, expect } from '@jest/globals';
import { roleOf } from '../../../src/graph/roleOf.js';

describe('roleOf', () => {
  it('classifies identity and permission objects as security', () => {
    expect(roleOf('User')).toBe('security');
    expect(roleOf('PermissionSet')).toBe('security');
  });

  it('matches setup objects exactly, never by prefix', () => {
    // Contract must not be read as ContentDocument, nor UserStory__c as User.
    expect(roleOf('UserStory__c')).toBe('business');
    expect(roleOf('Contract')).toBe('business');
  });

  it('classifies by suffix where Salesforce gives one', () => {
    expect(roleOf('Setting__mdt')).toBe('configuration');
    expect(roleOf('Order_Event__e')).toBe('integration');
    expect(roleOf('External__x')).toBe('integration');
    expect(roleOf('AccountShare')).toBe('sharing');
    expect(roleOf('AccountHistory')).toBe('sharing');
  });

  it('falls back to business, which is the useful default', () => {
    expect(roleOf('Order__c')).toBe('business');
  });
});
