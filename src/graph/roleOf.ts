/**
 * Architectural layers of a Salesforce org's coupling graph.
 *
 * A real org's graph is dominated by objects that carry no business process — User, Profile,
 * PermissionSet, logger tables, custom metadata — because Apex references them constantly.
 * Filtering them out is tempting and wrong: on a production org, business↔security was the
 * second-heaviest relationship in the entire graph, behind only business-internal coupling.
 * That is a genuine architectural finding (the business model is deeply wired into the
 * permission model) and deleting the objects deletes the finding.
 *
 * Classifying instead of filtering keeps every object, and turns the noise into structure.
 */

import type { ObjectLayer } from '../schemas/index.js';

export const LAYER_DESCRIPTIONS: Readonly<Record<ObjectLayer, string>> = {
  integration: 'platform events and external data',
  configuration: 'custom metadata driving behaviour',
  business: 'business process',
  content: 'files, documents and email',
  sharing: 'sharing, history and change tracking',
  security: 'identity and permissions',
  observability: 'logging and instrumentation',
};

/**
 * Setup and platform objects. Matched exactly rather than by prefix: `Contract` must not be
 * mistaken for `ContentDocument`, nor `UserStory__c` for `User`.
 */
const SECURITY_OBJECTS: ReadonlySet<string> = new Set([
  'User', 'Profile', 'PermissionSet', 'PermissionSetAssignment', 'PermissionSetGroup',
  'PermissionSetGroupComponent', 'PermissionSetLicense', 'PermissionSetLicenseAssign',
  'UserRole', 'UserLicense', 'UserRecordAccess', 'UserPermissionAccess', 'SetupEntityAccess',
  'CustomPermission', 'Organization', 'LoginHistory', 'AuthSession', 'AuthProvider',
  'ThirdPartyAccountLink', 'CronTrigger', 'AsyncApexJob', 'ApexClass', 'ApexTrigger',
  'ApexEmailNotification', 'AuraDefinitionBundle', 'FlowDefinitionView', 'FlowVersionView',
  'Group', 'GroupMember', 'QueueSobject', 'ObjectPermissions', 'FieldPermissions',
  'EntityDefinition', 'FieldDefinition', 'Identifier', 'StaticResource', 'Topic',
  'TopicAssignment', 'SetupAuditTrail', 'NetworkMemberGroup',
]);

const CONTENT_OBJECTS: ReadonlySet<string> = new Set([
  'Attachment', 'Document', 'EmailMessage', 'EmailTemplate', 'Note',
]);

/** Which layer an object belongs to. Unrecognised objects are business, never hidden. */
export function roleOf(object: string): ObjectLayer {
  if (SECURITY_OBJECTS.has(object)) return 'security';
  if (/^Logger?[A-Z_]/.test(object) || /^Log(Entry|Status|Retention)/.test(object)) return 'observability';
  if (object.endsWith('__mdt')) return 'configuration';
  if (object.endsWith('__e') || object.endsWith('__x')) return 'integration';
  if (/(?:Share|History|Feed|ChangeEvent)$/.test(object)) return 'sharing';
  if (CONTENT_OBJECTS.has(object) || /^Content[A-Z]/.test(object)) return 'content';
  return 'business';
}
