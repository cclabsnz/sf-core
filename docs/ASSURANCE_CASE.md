# Assurance case

An argument that `@cclabsnz/sf-core` is secure enough for what it does, with the evidence for
each claim and the limitations that are accepted rather than solved. It is written to be
falsifiable: every claim below names the mechanism that would fail if the claim stopped being
true.

This is the security-relevant design document referred to by [SECURITY.md](../SECURITY.md).

## What this software does, and what could go wrong

This package reads a Salesforce org and writes two kinds of output: captured event data, to
disk under the operator's home directory, and HTML reports, which its dependants hand to
clients. It holds no credentials of its own, uses the Salesforce CLI's existing authenticated
connection, and exposes no network service.

The threats that matter therefore are not "an attacker attacks the library". They are:

1. The tool **modifies** an org it was trusted to only read.
2. The tool **sends org data somewhere** other than the org it authenticated against.
3. Org-controlled data **escapes its context** — into a filesystem path, into a SOQL query, or
   into a generated report opened by someone else.
4. The tool **reports something untrue** about an org, so a reader draws a false conclusion.
5. A **supply-chain compromise** substitutes different code for what the source says.

Everything below argues against those five.

## Claim 1: it cannot modify an org

**Argument.** All org access is concentrated in four client interfaces (`SoqlClient`,
`ToolingClient`, `RestClient`, `MetadataClient`), which expose only queries, REST GETs, and
metadata list/retrieve. No write method exists to call.

**Evidence.** `test/unit/invariants/readonly-invariant.test.ts` statically scans every source
file for org-mutating patterns: `create`/`update`/`upsert`/`insert`/`destroy`/`delete` on a
connection, sObject, tooling or metadata handle; bulk and composite paths; and HTTP write
verbs. A match fails the build. The check is static, so a mutating call cannot pass by simply
not executing during tests.

**Limitation.** The scan is pattern-based. Sufficiently indirect construction of a call (for
example, a method name assembled at runtime) would evade it. This is accepted: the same
indirection would be visible in review, and the rule is a floor rather than a proof.

## Claim 2: it sends nothing anywhere but the authenticated org

**Argument.** The only HTTP client is the one inside `@salesforce/core`, pointed at the org
the operator authenticated against. There is no telemetry, no analytics, and no model API.
Generated reports are self-contained, so opening one offline requests nothing.

**Evidence.** `test/unit/invariants/network-egress.test.ts` fails the build if any source file
imports a third-party HTTP client (`axios`, `got`, `node-fetch`, `undici`, and others), uses
the bare `http`/`https` modules, or emits markup referencing a remote script, stylesheet or
`@import`. Fonts are embedded as data URIs by `src/report/fonts.ts` for this reason.

**Why this is load-bearing.** Reports contain real product names, user counts and endpoints.
A single remote asset reference would disclose to a third party that a given report was
opened, and when.

## Claim 3: org data cannot escape its context

Org-controlled strings reach three sinks. Each has a rule, and each rule has been tested
against a real defect rather than assumed.

**Filesystem paths.** `EventType`, object names, org ids and file ids are joined into paths
under the operator's home directory. `segment()` in `EventBaselineStore` reduces each to a
single safe path segment: anything that is not `[A-Za-z0-9._-]` folds to `_`, and a value
that reduces to only dots becomes `_`. A value of `../../..` therefore cannot place captured
evidence outside the store.

**SOQL.** Identifiers interpolated into a query are filtered to an allowlist
(`[A-Za-z0-9_]`) and numeric clauses are coerced with `Math.trunc`, as in
`pullRealtimeEvents`. Allowlisting is used rather than escaping because the values are
identifiers, where anything outside the allowlist is meaningless rather than merely dangerous.

**Generated HTML.** Every interpolated value passes through `esc`. Two limits of `esc` are
worth stating because they have caused real defects in this family of repositories: it
escapes `&`, `<`, `>` and `"`, so it is correct for element text and **double-quoted**
attributes only; and it is **not sufficient inside a `<script>` element**, where JSON must
additionally escape `<` so that a value containing a closing script tag cannot terminate the
element early.

## Claim 4: it does not report something untrue

This is a security claim, not a quality one: a security tool that under-reports produces
false confidence, which is worse than no report.

**Argument.** A read that was refused is never rendered as an absence of the thing. Failures
are recorded as structured data and surfaced, rather than collapsing into a zero.

**Evidence.** Absent-versus-refused is distinguished explicitly: an `INVALID_TYPE` or
"sObject type ... is not supported" error means the feature is genuinely absent on that org,
while any other error is a failed read and is recorded as such. Captures are written
atomically, so presence of a file on disk means the capture completed.

**Limitation, stated plainly.** A green test suite is evidence that the code does what the
tests say, never that it matches the platform. Every serious defect in this codebase was
found by running against a real org or by chasing a number that did not reconcile: the
Real-Time Event catalog was wrong in both directions because it was written from a naming
convention rather than measured. Mitigation is procedural, not technical, and is recorded in
[CONTRIBUTING.md](../CONTRIBUTING.md): reconcile at least one number against a real org
before trusting a new capture path.

## Claim 5: what is published is what the source says

**Argument.** Releases are built and published by CI from a public commit, with no
long-lived credential that could be stolen and used to publish something else.

**Evidence.** Publishing uses npm Trusted Publishing over OIDC: no npm token is stored. The
published tarball carries a SLSA provenance attestation linking it to the exact commit,
verifiable with `npm view @cclabsnz/sf-core --json` (`dist.attestations`) or
`npm audit signatures`. Dependencies are installed from a committed lockfile with integrity
hashes using `--frozen-lockfile`. Every GitHub Action is pinned by commit SHA. A CycloneDX
SBOM is attached to each release. CodeQL (security-extended), Semgrep, Socket and OpenSSF
Scorecard run on every change, and Dependabot covers both npm and GitHub Actions.

**Limitation.** Git tags are not GPG-signed. Integrity is established at the published
artefact rather than at the tag; this is an accepted trade, recorded here rather than left
implicit.

## Accepted limitations

Stated together so they are not discovered one at a time:

- **One maintainer.** A single point of failure for review, release and security response.
  See [GOVERNANCE.md](../GOVERNANCE.md), which also describes what happens to the project if
  that person becomes unavailable.
- **No dynamic analysis.** No fuzzer or sanitiser is applied. The inputs are Salesforce API
  responses and the software exposes no network service, so the value would be low relative
  to the effort. Assertion-heavy tests and strict compilation are the substitute.
- **Static invariants are pattern-based**, as described under Claim 1.
- **Branch coverage is near 75%**, below statement coverage, and the gap is concentrated in
  error paths — which is where the absent-versus-refused distinction lives. This is tracked
  in [ROADMAP.md](../ROADMAP.md).
- **Tags are unsigned**, as described under Claim 5.

## How to falsify this

Each claim above is tied to a mechanism that can be run:

```bash
pnpm test     # includes both invariant tests
pnpm build
npm view @cclabsnz/sf-core --json   # dist.attestations
```

If any invariant test is deleted, weakened, or has its rule list narrowed, the corresponding
claim on this page is no longer supported and should be removed from it.
