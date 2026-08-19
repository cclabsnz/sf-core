# Governance

`@cclabsnz/sf-core` is a small project with a single maintainer. This document says so
plainly, describes who does what, and states what happens to the project if that person
becomes unavailable. It is written to be accurate rather than aspirational: a governance
document that describes a committee which does not exist is worse than none.

## Project scope

This package is the shared platform layer beneath the CloudCounsel Salesforce `sf` plugins.
It is a library, not an end-user tool. Its scope is deliberately narrow: read-only API
clients, org context, platform-behaviour helpers, event log capture, the findings model,
the report shell, and the versioned IR contracts that the plugins exchange.

Anything specific to one plugin belongs in that plugin, not here. A change is in scope for
this repository when both consumers would otherwise implement it twice, or when it concerns
the org boundary itself.

## Roles and responsibilities

| Role | Held by | Responsibilities |
| --- | --- | --- |
| **Maintainer** | CloudCounsel Limited (`cclabsnz`) | Final say on scope and design. Reviews and merges pull requests. Cuts releases. Owns the security contact in [SECURITY.md](SECURITY.md). Administers the GitHub repository and the npm package. |
| **Contributor** | Anyone | Opens issues and pull requests. Contributions are accepted under Apache-2.0. There is no contributor licence agreement and no copyright assignment; contributors keep their copyright. |
| **Security reporter** | Anyone | Reports vulnerabilities privately through the channels in [SECURITY.md](SECURITY.md). Credited in the release notes unless they prefer anonymity. |

There is currently **one maintainer**. This is the project's principal governance weakness
and is recorded as such rather than concealed: it is a single point of failure for review,
release and security response. It is stated in the assurance case
([docs/ASSURANCE_CASE.md](docs/ASSURANCE_CASE.md)) as an accepted limitation.

## How decisions are made

Technical decisions are made by the maintainer, in the open, in the pull request or issue
that proposes them. Where a decision is durable rather than incidental, the reasoning is
committed with it: specifications live in `docs/`, and the commit message carries the
argument. A decision that only exists in someone's head is treated as undocumented.

Disagreement is resolved by evidence about the platform, not by seniority. Where a claim
about Salesforce behaviour is in dispute, the resolution is to measure it against a real org
and record the reading.

## Change control

Every change reaches `main` through a pull request. This is enforced by branch protection
rather than convention:

- `main` is protected with `enforce_admins` enabled, so the maintainer is bound by the same
  rules as anyone else.
- Seven status checks are required, including build and tests, static analysis, and the
  org-data guard.
- Linear history is required; merge commits and force pushes are disabled, and branches
  cannot be deleted.
- Conversation resolution is required before merge.

## Releases

Releases are cut from `main` by publishing a GitHub Release, which triggers the publish
workflow. The workflow publishes to npm using **Trusted Publishing over OIDC**: there is no
long-lived npm token stored anywhere, and the published tarball carries a provenance
attestation linking it to the exact public commit. See [docs/RELEASE.md](docs/RELEASE.md).

Because both plugins consume this package from npm rather than by path, a change here has to
be released before either can use it, and a regression reaches both at once. Releases are
therefore small and frequent by preference.

## Access continuity

The risks worth naming are loss of access and loss of the maintainer.

- **Repository.** The repository belongs to the `cclabsnz` GitHub organisation, not to a
  personal account. Organisation ownership is what allows access to be granted to someone
  else without transferring anything.
- **npm.** The package is published under the `@cclabsnz` scope. Publishing rights follow
  the GitHub repository through Trusted Publishing rather than a stored token, so restoring
  the ability to publish means restoring repository access, not recovering a secret.
- **No irreplaceable secrets.** The release path holds no signing key or npm token that
  could be lost. This is a deliberate consequence of using OIDC rather than stored
  credentials, and it is the main reason continuity here is a matter of account access
  rather than key custody.
- **Everything needed to rebuild is public.** The source, the lockfile, the build and the
  release workflow are all in this repository. A fork can be built and published under a
  different scope by anyone, without cooperation from the current maintainer.
- **If the maintainer becomes unavailable**, the project should be considered unmaintained
  until someone with organisation access says otherwise. Users should read the absence of
  releases as exactly that. The licence permits anyone to fork and continue.

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). The maintainer is
responsible for enforcement; reports go to the address in that document.
