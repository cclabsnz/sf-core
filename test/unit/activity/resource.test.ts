import { describe, it, expect } from '@jest/globals';
import { resourceSegments, isCompositeContainer } from '../../../src/activity/resource.js';

describe('resourceSegments', () => {
  it('strips the version prefix so both resource spellings describe the same call', () => {
    expect(resourceSegments('/v61.0/sobjects/Account')).toEqual(['sobjects', 'account']);
    expect(resourceSegments('/services/data/v61.0/sobjects/Account')).toEqual(['sobjects', 'account']);
  });

  it('accepts a version with or without a minor part', () => {
    expect(resourceSegments('/v61/query')).toEqual(['query']);
    expect(resourceSegments('/v61.0/query')).toEqual(['query']);
  });

  it('keeps every segment when there is no version', () => {
    expect(resourceSegments('/sobjects/Account/describe')).toEqual(['sobjects', 'account', 'describe']);
  });

  it('drops the query string and normalises case and surrounding space', () => {
    expect(resourceSegments('  /v61.0/queryAll/?q=SELECT+Id  ')).toEqual(['queryall']);
  });

  it('does not treat a non-version segment beginning with v as a version', () => {
    expect(resourceSegments('/vault/secrets')).toEqual(['vault', 'secrets']);
    expect(resourceSegments('/v61x/query')).toEqual(['v61x', 'query']);
    expect(resourceSegments('/v61.0.1/query')).toEqual(['v61.0.1', 'query']);
  });

  // The previous implementation matched /\/v[\d.]+\// — the character class could consume the
  // '.' and '/' delimiting it, so this input made the engine retry every split point. A single
  // pass cannot backtrack, so the bound here is generous by three orders of magnitude and still
  // fails loudly if a quantified regex is ever reintroduced.
  it('does not degrade on an input crafted to backtrack', () => {
    const adversarial = '/v.'.repeat(20_000) + 'a';
    const started = process.hrtime.bigint();
    const out = resourceSegments(adversarial);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(out.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(1000);
  });
});

describe('isCompositeContainer', () => {
  it('recognises a container at either resource spelling', () => {
    expect(isCompositeContainer('/v61.0/composite')).toBe(true);
    expect(isCompositeContainer('/services/data/v58.0/composite')).toBe(true);
    expect(isCompositeContainer('/v61.0/composite/graph')).toBe(true);
  });

  it('is not fooled by composite appearing elsewhere in the path', () => {
    // The substring check this replaced treated this as a container; the segment check does not.
    expect(isCompositeContainer('/v58.0/sobjects/Composite')).toBe(false);
    expect(isCompositeContainer('/v61.0/composite/batch/1')).toBe(false);
  });
});
