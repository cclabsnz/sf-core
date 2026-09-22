import { isCompositeContainer } from './resource.js';
import { byTime } from './time.js';
import type { ActivityEvent, CompositeJoinResult } from './types.js';

/**
 * True when this event is a composite container rather than a real operation.
 *
 * Prefix-tolerant on purpose: ApiTotalUsage logs `/v61.0/composite` while RestApi logs
 * `/services/data/v58.0/composite`. Anchoring on the version segment missed the second
 * shape here exactly as it did in classify.ts, and a missed parent loses its children's
 * attribution rather than failing loudly.
 */
function isCompositeParent(e: ActivityEvent): boolean {
  return isCompositeContainer(e.resource ?? '');
}

/**
 * Join composite parents to their subrequests on REQUEST_ID.
 *
 * REQUEST_ID is the only safe join key between two event log types: ApiTotalUsage and RestApi
 * record different id forms for the same connected app, so joining on app id silently produces
 * nothing.
 *
 * Parents are retained as containers. Children inherit actor and app from their parent because
 * CompositeApiSubrequest records neither, and unattributed children cannot be traced to a user.
 *
 * A parent that resolves is emitted with `decomposedInto` set to its child count. Its `kind`
 * stays `unknown` — a container has no operation of its own — but the marker lets a consumer
 * exclude it from unclassified totals rather than counting it alongside genuinely unresolvable
 * events.
 */
export function decomposeComposite(
  parents: readonly ActivityEvent[],
  subrequests: readonly ActivityEvent[],
): CompositeJoinResult {
  const byRequest = new Map<string, ActivityEvent[]>();
  for (const s of subrequests) {
    const id = s.requestId;
    if (id === undefined) continue;
    const list = byRequest.get(id);
    if (list === undefined) byRequest.set(id, [s]);
    else list.push(s);
  }

  const events: ActivityEvent[] = [];
  const claimed = new Set<string>();
  let resolved = 0;
  let unresolved = 0;
  let duplicates = 0;

  for (const p of parents) {
    if (!isCompositeParent(p)) {
      events.push(p);
      continue;
    }

    const id = p.requestId;
    if (id === undefined) {
      events.push(p);
      unresolved += 1;
      continue;
    }
    if (claimed.has(id)) {
      events.push(p);
      duplicates += 1;
      continue;
    }
    const kids = byRequest.get(id);
    if (kids === undefined) {
      events.push(p);
      unresolved += 1;
      continue;
    }
    resolved += 1;
    claimed.add(id);
    events.push({ ...p, decomposedInto: kids.length });
    for (const k of kids) {
      events.push({ ...k, actor: k.actor === '' ? p.actor : k.actor, app: k.app ?? p.app });
    }
  }

  // Children whose parent is not in the input. Retained: dropping them would understate
  // activity, and the caller is told how many there were.
  let orphans = 0;
  for (const [id, kids] of byRequest) {
    if (claimed.has(id)) continue;
    orphans += kids.length;
    for (const k of kids) events.push(k);
  }

  events.sort(byTime);
  return { events, resolved, unresolved, orphans, duplicates };
}
