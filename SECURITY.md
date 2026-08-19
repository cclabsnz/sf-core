# Security Policy

`@cclabsnz/sf-core` is the shared platform layer beneath the CloudCounsel Salesforce
`sf` plugins: API clients, org context, event log pull, and report rendering. It is a
**library**, not a CLI plugin, and it is **read-only** with respect to any Salesforce
org: it issues only SOQL / Tooling / REST GET queries and never modifies an org.

Because it sits underneath the other plugins, a defect here reaches all of them. Two
of its responsibilities are security-relevant in their own right: it writes captured
event data to disk under the operator's home directory, and it renders the HTML that
downstream plugins hand to clients.

## Supported versions

The latest published minor version receives security fixes. Please upgrade to the
newest release before reporting an issue.

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |
| older   | ❌        |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use one of the following private channels:

- **GitHub private vulnerability reporting:** open the repository's **Security**
  tab and choose **Report a vulnerability** (preferred).
- **Email:** [hello@cloudcounsel.co.nz](mailto:hello@cloudcounsel.co.nz) with the
  subject line `SECURITY: sf-core`.

Please include:

- the package version (`npm ls @cclabsnz/sf-core`, or the version recorded by the
  plugin that depends on it),
- a description of the issue and its impact,
- steps to reproduce, and
- any relevant logs, **with org identifiers and secrets redacted**.

## What to expect

- We aim to acknowledge a report within **5 business days**.
- We will confirm the issue, keep you updated on remediation, and credit you in the
  release notes unless you prefer to remain anonymous.
- Please give us a reasonable window to release a fix before any public disclosure.

## Scope

In scope: this package's code, its handling of org data and credentials, the paths it
writes to, and the HTML it renders on behalf of dependent plugins. Out of scope:
vulnerabilities in Salesforce itself, in the `sf` CLI, or in third-party dependencies
(report those upstream; we will bump dependencies promptly via Dependabot).

## Release integrity & assurance

- **Read-only, enforced.** `test/unit/invariants/readonly-invariant.test.ts` fails the
  build if any org-mutating API, HTTP write verb, or bulk/composite write path is
  introduced into the source.
- **No network egress.** `test/unit/invariants/network-egress.test.ts` fails the build
  if any code path could contact a third party. The only destination is the org the
  operator authenticated against. Rendered reports are self-contained: fonts are
  inlined as data URIs, and there is no `script src`, stylesheet link, or fetch.
- **Confined writes.** Every org-supplied value used in a filesystem path is reduced to
  a single safe path segment before it is joined, so captured evidence cannot be placed
  outside the store.
- **No org data in the repository.** A guard runs in CI and as a pre-commit hook,
  rejecting org ids, sandbox hostnames and generated artefacts in the tree and in
  commit messages.
- **Build provenance.** Releases are published from GitHub Actions over OIDC trusted
  publishing, with npm provenance and no stored token. Verify with
  `npm view @cclabsnz/sf-core --json` and check the `dist.attestations` field.
- **Static analysis & supply chain.** CodeQL, Semgrep, Socket and OpenSSF Scorecard run
  on every change; every GitHub Action is pinned by commit SHA; and a CycloneDX SBOM is
  attached to each GitHub Release.
