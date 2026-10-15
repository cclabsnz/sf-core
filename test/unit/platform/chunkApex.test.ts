import { chunkApexBody, testApexPattern } from '../../../src/platform/salesforceId.js';

describe('chunkApexBody & testApexPattern', () => {
  it('returns single chunk for small body', () => {
    const code = 'public class SmallClass { public void test() {} }';
    expect(chunkApexBody(code, 50_000, 2_000)).toEqual([code]);
    expect(chunkApexBody('', 50_000, 2_000)).toEqual([]);
  });

  it('splits body larger than chunkSize with sliding overlap', () => {
    // 100,000 chars body with a needle at character 60,000
    const partA = ' '.repeat(60_000);
    const needle = 'WITH USER_MODE';
    const partB = ' '.repeat(40_000);
    const fullBody = partA + needle + partB;

    const chunks = chunkApexBody(fullBody, 50_000, 2_000);
    expect(chunks.length).toBeGreaterThan(1);

    // Chunks overlap
    expect(chunks[0].length).toBe(50_000);
    expect(chunks[1].startsWith(' '.repeat(2_000))).toBe(true);

    // Needle is found safely via testApexPattern
    expect(testApexPattern(fullBody, /\bWITH\s+USER_MODE\b/i, 50_000, 2_000)).toBe(true);
    expect(testApexPattern(fullBody, /\bWITH\s+SYSTEM_MODE\b/i, 50_000, 2_000)).toBe(false);
  });

  it('matches pattern crossing boundary within overlap window', () => {
    // Boundary at 50,000; needle placed at 49,990
    const prefix = 'X'.repeat(49_990);
    const needle = 'Database.insert(records, AccessLevel.USER_MODE);';
    const suffix = 'Y'.repeat(10_000);
    const body = prefix + needle + suffix;

    expect(testApexPattern(body, /AccessLevel\.USER_MODE/i, 50_000, 2_000)).toBe(true);
  });

  it('rejects window sizes that would never advance or step one character at a time', () => {
    expect(() => chunkApexBody('x'.repeat(10), 0, 0)).toThrow(RangeError);
    expect(() => chunkApexBody('x'.repeat(10), 5, 5)).toThrow(RangeError);
    expect(() => chunkApexBody('x'.repeat(10), 5, 9)).toThrow(RangeError);
    expect(() => chunkApexBody('x'.repeat(10), 5, -1)).toThrow(RangeError);
    expect(() => chunkApexBody('x'.repeat(10), 5.5, 1)).toThrow(RangeError);
  });

  it('covers every character, with each window overlapping the next by exactly `overlap`', () => {
    const body = Array.from({ length: 1_000 }, (_, i) => String.fromCharCode(65 + (i % 26))).join('');
    const chunks = chunkApexBody(body, 100, 10);
    expect(chunks[0]).toBe(body.slice(0, 100));
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].slice(0, 10)).toBe(chunks[i - 1].slice(-10));
    expect(chunks.at(-1)!.endsWith(body.slice(-1))).toBe(true);
    expect(chunks.join('').length).toBeGreaterThanOrEqual(body.length);
  });

  it('leaves a global regex reusable after a match', () => {
    const re = /USER_MODE/g;
    expect(testApexPattern('a USER_MODE b', re)).toBe(true);
    expect(re.lastIndex).toBe(0);
    expect(testApexPattern('USER_MODE', re)).toBe(true);
  });

  it('misses a match longer than the overlap that straddles a boundary, as documented', () => {
    // Windows are [0,100), [90,190), [180,200); a run at [85,105) fits in none of them.
    const body = 'x'.repeat(85) + 'A'.repeat(20) + 'x'.repeat(95);
    expect(testApexPattern(body, /A{20}/, 100, 10)).toBe(false);
    expect(testApexPattern(body, /A{20}/, 100, 30)).toBe(true);
  });
});
