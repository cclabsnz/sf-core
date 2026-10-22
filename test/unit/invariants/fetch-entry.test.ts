import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * The ./fetch entry point must never load @salesforce/core or jsforce, not even as a type import,
 * because the Lambda bundle cannot resolve them. This walks every relative import and
 * `export ... from` reachable from src/fetch.ts and checks each file's specifiers.
 */

const SRC = join(process.cwd(), 'src');
const FORBIDDEN = /@salesforce\/core|jsforce/;
// import ... from 'x', import 'x', export ... from 'x', import('x'). `import type` matches the first form.
const SPECIFIER = /(?:\bimport|\bexport)\s*(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(SPECIFIER)].map((m) => m[1] ?? m[2]);
}

function walk(entry: string, root = SRC): { visited: Set<string>; offenders: string[]; unresolved: string[] } {
  const visited = new Set<string>();
  const offenders: string[] = [];
  const unresolved: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (visited.has(file)) continue;
    visited.add(file);
    const rel = file.slice(root.length + 1);
    for (const spec of specifiers(file)) {
      if (FORBIDDEN.test(spec)) offenders.push(`${rel} -> ${spec}`);
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec).replace(/\.js$/, '.ts');
        if (existsSync(target)) queue.push(target);
        else unresolved.push(`${rel} -> ${spec}`);
      }
    }
  }
  return { visited, offenders, unresolved };
}

describe('./fetch entry point', () => {
  it('reaches @salesforce/core and jsforce from nowhere', () => {
    const { visited, offenders, unresolved } = walk(join(SRC, 'fetch.ts'));
    // Guard against a vacuous pass: a broken resolver would visit one file and find nothing.
    expect(visited.size).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
    // A relative import the walker cannot resolve is a file it never checked, so it fails too.
    expect(unresolved).toEqual([]);
  });

  it('reports a relative import it cannot resolve instead of skipping it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fetch-entry-'));
    try {
      writeFileSync(join(dir, 'entry.ts'), "export * from './missing.js';\n");
      expect(walk(join(dir, 'entry.ts'), dir).unresolved).toEqual(['entry.ts -> ./missing.js']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
