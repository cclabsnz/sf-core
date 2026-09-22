/**
 * True for an API version path segment: `v61`, `v61.0`. Hand-written rather than a regex.
 *
 * The regex this replaces, `/\/v[\d.]+\//`, was a polynomial ReDoS: `[\d.]+` can match the
 * `.` and `/` that delimit it, so an input of many repeated `/v./` sequences made the engine
 * retry every split point. Resource strings come straight from log rows, in volume, so the
 * input is attacker-shaped in exactly the way that matters. A single pass with no alternation
 * and no quantifier cannot backtrack.
 */
function isVersionSegment(segment: string): boolean {
  if (segment.length < 2 || segment[0] !== 'v') return false;
  let dots = 0;
  for (let i = 1; i < segment.length; i += 1) {
    const c = segment[i];
    if (c === '.') {
      dots += 1;
      if (dots > 1) return false;
    } else if (c < '0' || c > '9') {
      return false;
    }
  }
  return true;
}

/** Path segments of an API resource with any version prefix removed, lowercased. */
export function resourceSegments(resource: string): string[] {
  const segments = resource
    .trim()
    .toLowerCase()
    .split('?')[0]
    .split('/')
    .filter((s) => s !== '');
  // Drop the version and everything before it, so `/services/data/v61.0/sobjects/account` and
  // `/v61.0/sobjects/account` describe the same call.
  const version = segments.findIndex(isVersionSegment);
  return version === -1 ? segments : segments.slice(version + 1);
}

/**
 * A composite container: `composite`, optionally followed by `graph`, and nothing else.
 *
 * One definition, used by both classify() and decomposeComposite(). Written twice before, and
 * the two copies disagreed: a substring search treated `/v58.0/sobjects/Composite` as a
 * container, while the first-segment approach correctly does not.
 */
export function isCompositeContainer(resource: string): boolean {
  const s = resourceSegments(resource);
  return s[0] === 'composite' && (s.length === 1 || (s.length === 2 && s[1] === 'graph'));
}
