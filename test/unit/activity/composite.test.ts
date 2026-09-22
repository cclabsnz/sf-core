import { describe, it, expect } from '@jest/globals';
import { decomposeComposite } from '../../../src/activity/composite.js';
import { isCompositeContainer } from '../../../src/activity/resource.js';
import type { ActivityEvent } from '../../../src/activity/types.js';

function ev(p: Partial<ActivityEvent>): ActivityEvent {
  return {
    at: '2026-09-06T01:00:00.000Z',
    actor: 'a@b.com',
    family: 'REST',
    operation: 'POST',
    kind: 'unknown',
    eventType: 'ApiTotalUsage',
    raw: {},
    ...p,
  };
}

describe('decomposeComposite', () => {
  it('attaches children to their parent and counts it resolved', () => {
    const parents = [ev({ resource: '/v61.0/composite', requestId: 'R1', app: 'Example Integration' })];
    const kids = [
      ev({ requestId: 'R1', operation: 'GET', resource: '/v52.0/query/', kind: 'read', eventType: 'CompositeApiSubrequest', app: undefined, actor: '' }),
      ev({ requestId: 'R1', operation: 'POST', resource: '/v52.0/composite/sobjects', kind: 'write', eventType: 'CompositeApiSubrequest', app: undefined, actor: '' }),
    ];
    const r = decomposeComposite(parents, kids);
    expect(r.resolved).toBe(1);
    expect(r.unresolved).toBe(0);
    expect(r.orphans).toBe(0);
    expect(r.events).toHaveLength(3);
  });

  it('inherits actor and app from the parent, since subrequests carry neither', () => {
    const parents = [ev({ resource: '/v61.0/composite', requestId: 'R1', app: 'Example Integration', actor: 'svc@x.com' })];
    const kids = [ev({ requestId: 'R1', eventType: 'CompositeApiSubrequest', app: undefined, actor: '' })];
    const child = decomposeComposite(parents, kids).events.find((e) => e.eventType === 'CompositeApiSubrequest');
    expect(child?.actor).toBe('svc@x.com');
    expect(child?.app).toBe('Example Integration');
  });

  it('leaves a parent unknown and counts it unresolved when no children exist', () => {
    const parents = [ev({ resource: '/v61.0/composite', requestId: 'R9' })];
    const r = decomposeComposite(parents, []);
    expect(r.unresolved).toBe(1);
    expect(r.resolved).toBe(0);
    expect(r.events[0].kind).toBe('unknown');
  });

  it('counts a parent with no requestId as unresolved rather than crashing', () => {
    const r = decomposeComposite([ev({ resource: '/v61.0/composite' })], []);
    expect(r.unresolved).toBe(1);
  });

  it('retains orphan children and counts them', () => {
    const kids = [ev({ requestId: 'ORPHAN', eventType: 'CompositeApiSubrequest', actor: '' })];
    const r = decomposeComposite([], kids);
    expect(r.orphans).toBe(1);
    expect(r.events).toHaveLength(1);
  });

  it('leaves non-composite parents untouched', () => {
    const parents = [ev({ resource: '/v61.0/sobjects/Account', operation: 'GET', kind: 'read', requestId: 'R1' })];
    const r = decomposeComposite(parents, []);
    expect(r.unresolved).toBe(0);
    expect(r.events[0].kind).toBe('read');
  });

  it('returns events in timestamp order so a later join cannot unsort the stream', () => {
    const parents = [ev({ at: '2026-09-06T01:00:05.000Z', resource: '/v61.0/composite', requestId: 'R1' })];
    const kids = [ev({ at: '2026-09-06T01:00:01.000Z', requestId: 'R1', eventType: 'CompositeApiSubrequest', actor: '' })];
    const ats = decomposeComposite(parents, kids).events.map((e) => e.at);
    expect(ats).toEqual(['2026-09-06T01:00:01.000Z', '2026-09-06T01:00:05.000Z']);
  });

  it('recognises a composite parent whatever prefix the log used', () => {
    const parents = [ev({ resource: '/services/data/v58.0/composite', requestId: 'R1', app: 'Example Integration', actor: 'svc@x.com' })];
    const kids = [ev({ requestId: 'R1', eventType: 'CompositeApiSubrequest', app: undefined, actor: '' })];
    const r = decomposeComposite(parents, kids);
    expect(r.resolved).toBe(1);
    expect(r.orphans).toBe(0);
    const child = r.events.find((e) => e.eventType === 'CompositeApiSubrequest');
    expect(child?.actor).toBe('svc@x.com');
    expect(child?.app).toBe('Example Integration');
  });

  it('does not re-attach children when two parents share a requestId', () => {
    const parents = [
      ev({ resource: '/v61.0/composite', requestId: 'R1', app: 'Example Integration' }),
      ev({ resource: '/v61.0/composite', requestId: 'R1', app: 'Example Integration' }),
    ];
    const kids = [ev({ requestId: 'R1', eventType: 'CompositeApiSubrequest', actor: '' })];
    const r = decomposeComposite(parents, kids);
    expect(r.resolved).toBe(1);
    expect(r.duplicates).toBe(1);
    expect(r.events.filter((e) => e.eventType === 'CompositeApiSubrequest')).toHaveLength(1);
    expect(r.events).toHaveLength(3);
  });

  it('keeps a child that carries its own actor rather than overwriting it', () => {
    const parents = [ev({ resource: '/v61.0/composite', requestId: 'R1', actor: 'parent@x.com', app: 'Example Integration' })];
    const kids = [ev({ requestId: 'R1', eventType: 'CompositeApiSubrequest', actor: 'child@x.com', app: 'Other' })];
    const child = decomposeComposite(parents, kids).events.find((e) => e.eventType === 'CompositeApiSubrequest');
    expect(child?.actor).toBe('child@x.com');
    expect(child?.app).toBe('Other');
  });

  it('marks a resolved parent with the count of children it decomposed into', () => {
    const parents = [ev({ resource: '/v61.0/composite', requestId: 'R1', app: 'Example Integration' })];
    const kids = [
      ev({ requestId: 'R1', eventType: 'CompositeApiSubrequest', app: undefined, actor: '' }),
      ev({ requestId: 'R1', eventType: 'CompositeApiSubrequest', app: undefined, actor: '' }),
    ];
    const r = decomposeComposite(parents, kids);
    const parent = r.events.find((e) => e.eventType === 'ApiTotalUsage');
    expect(parent?.decomposedInto).toBe(2);
  });

  it('leaves decomposedInto unset on a parent that does not resolve', () => {
    const parents = [ev({ resource: '/v61.0/composite', requestId: 'R9' })];
    const r = decomposeComposite(parents, []);
    expect(r.events[0].decomposedInto).toBeUndefined();
  });
});

describe('isCompositeContainer', () => {
  it('does not mistake an sObject named Composite for a composite container', () => {
    expect(isCompositeContainer('/v58.0/sobjects/Composite')).toBe(false);
    expect(isCompositeContainer('/v58.0/composite/sobjects/composite')).toBe(false);
    expect(isCompositeContainer('/v61.0/composite')).toBe(true);
    expect(isCompositeContainer('/services/data/v58.0/composite')).toBe(true);
    expect(isCompositeContainer('/v52.0/composite/graph')).toBe(true);
    expect(isCompositeContainer('/v61.0/composite?a=b')).toBe(true);
    expect(isCompositeContainer('/v52.0/composite/sobjects')).toBe(false);
  });
});
