# Contributing to @cclabsnz/sf-core

Thanks for your interest in improving the shared platform layer. This document covers how
to get set up, the conventions the project follows, and what a good contribution looks like.

## What this package is

`@cclabsnz/sf-core` is a **library**, not an `sf` plugin. It provides the API clients, org
context, event log capture, findings model and report rendering that
[`@cclabsnz/sf-orgintel`](https://github.com/cclabsnz/sf-orgintel) and
[`@cclabsnz/sf-audit`](https://github.com/cclabsnz/sf-audit-plugin) build on.

Two consequences shape everything here:

1. **A defect reaches every dependant.** Both plugins consume this package from npm rather
   than by path, so a change has to be published before they can use it, and a regression
   ships to both at once.
2. **Two responsibilities are security-relevant in their own right:** it writes captured
   event data to disk under the operator's home directory, and it renders the HTML that
   dependent plugins hand to clients.

## Getting started

TypeScript (ESM, NodeNext).

```bash
git clone https://github.com/cclabsnz/sf-core.git
cd sf-core
pnpm install
pnpm build
pnpm test
```

- **Package manager:** the lockfile is `pnpm-lock.yaml`. Use `pnpm`.
- **ESM/NodeNext:** relative imports must end in `.js` even inside `.ts` files.
- **`pnpm prepare` sets `core.hooksPath` to `.githooks`.** If you clone and skip
  `pnpm install`, the pre-commit guard does not run. Confirm with
  `git config core.hooksPath`.
- Entry points are `.` (the library), `./testing` (invariant helpers dependants reuse) and
  `./schemas/*`. Anything not exported from `src/index.ts` is internal and may change.

## Non-negotiable rules

Each of these is enforced by a test that fails the build. They are not matters of taste:

- **Read-only.** Only SOQL / Tooling / REST GET. No DML, no metadata deploy, no record
  modification, ever. `test/unit/invariants/readonly-invariant.test.ts`.
- **No network egress.** The only destination is the org the operator authenticated
  against. Rendered reports are self-contained: fonts inlined as data URIs, no
  `script src`, no stylesheet link, no fetch.
  `test/unit/invariants/network-egress.test.ts`.
- **No org data in the repository.** Org ids, sandbox hostnames and generated artefacts must
  not reach the tree or a commit message. The guard runs in CI and as a pre-commit hook.

## Coding standards

- **Confine every path built from org data.** `EventType`, object names, org ids and file
  ids all arrive from query results and are joined into filesystem paths. Reduce each to a
  single safe segment first; a value of `../../..` would place captured evidence outside the
  store, and this package writes under the operator's home directory.
- **Escape everything that came from an org** before it reaches markup, and remember that
  `esc()` is for HTML text and double-quoted attributes. It is not sufficient inside a
  `<script>` element, where `JSON.stringify` output also needs `<` escaped.
- **Allowlist, do not sanitise, when building SOQL.** Filter identifiers to
  `[A-Za-z0-9_]` and coerce numeric clauses, as `pullRealtimeEvents` does.
- **Lint is a gate, not a suggestion.** `pnpm run lint` runs oxlint over `src` and `test`
  with the correctness category set to error, and CI runs it in the required build-test job.
- **Deterministic output.** The same input must produce the same bytes. No `Date.now()` or
  `Math.random()` in a render path.
- **Presence on disk means complete.** Write captures atomically via a temp file and
  rename, so a partial file is never mistaken for a finished one.

## Testing policy

- Unit tests only, with mocked SOQL / Tooling / REST clients. **Never point a test at a real
  org.** Use the helpers exported from `./testing`.
- A green suite is evidence the code does what the tests say, never that it matches the
  platform. Reconcile at least one number against a real org before trusting a new capture
  path. Every serious defect in this codebase was found that way, not by a failing test.

## Before you open a pull request

```bash
pnpm run lint && pnpm test && pnpm build
```

All three must exit 0. Check the exit code rather than reading the last lines of output: piping a
compiler into `tail` reports the exit status of `tail`. There is no `typecheck` script here;
`pnpm test` type-checks as it runs.

If your change affects a dependant, say so in the pull request. It has to be published before
either plugin can pick it up.

## Reporting bugs and requesting features

Open an issue at <https://github.com/cclabsnz/sf-core/issues>. Include the package version,
what you ran, what you expected and what happened, **with org identifiers redacted**.

For anything security-relevant, do not open a public issue. Follow
[SECURITY.md](SECURITY.md) instead.
