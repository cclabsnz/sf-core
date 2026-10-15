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
});
