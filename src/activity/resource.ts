/** Path segments of an API resource with any version prefix removed, lowercased. */
export function resourceSegments(resource: string): string[] {
  const r = resource.trim().toLowerCase();
  const afterVersion = /\/v[\d.]+\/(.*)$/.exec(r);
  return (afterVersion ? afterVersion[1] : r).split('?')[0].split('/').filter((s) => s !== '');
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
