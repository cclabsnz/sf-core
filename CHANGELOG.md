# Changelog

All notable changes to `@cclabsnz/sf-core` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely, and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each released entry mirrors the [GitHub Release](https://github.com/cclabsnz/sf-core/releases)
for that tag, which is the canonical published note and carries the provenance attestation and
CycloneDX SBOM for the build.

## [Unreleased]

Merged to `main`, not yet released.

### Security

- `js-yaml` override raised to the first patched version, closing GHSA-5p4m-2wfm-xmqj
  (quadratic CPU consumption in `!!omap` resolution). The override already permitted the fix
  without requiring it, so the lockfile stayed on the vulnerable version: a caret that allows a
  patch is not a floor that forces one. Development-scope transitive dependency; nothing shipped
  to consumers was affected. (#8)
- `SECURITY.md` rewritten. It was `sf-audit`'s, copied verbatim: it described this package as a
  security audit plugin, named the wrong package throughout, and told reporters to run a CLI
  command that does not apply to a library. Private vulnerability reporting has also been enabled
  on the repository, which the policy had named as the preferred channel while it was switched
  off. (#9)
- `/.superpowers/` added to `.gitignore`. Execution ledgers quote live-org detail as a matter of
  course, and this repository is public. Nothing was ever tracked under that path. (#9)

### Fixed

- **Four Real-Time Event objects were missing from the catalog**, and had been since it was
  written: `LoginAnomalyEvent`, `UniversalAnomalyEvent`, `IdentityVerificationEvent` and
  `ApiPrtcPolicyChangeEvent`. All four were verified across eight orgs. `LoginAnomalyEvent` is
  the one that mattered — login anomaly is precisely the signal this catalog exists to retain.
  The 0.3.0 probe checked that every declared object behaved as declared and found nothing
  wrong; it never asked the inverse question. A missing entry raises no error anywhere, so the
  pull simply never asked for these objects and the manifest recorded no gap, leaving a
  consumer to read the silence as "this org had no such events" rather than "we did not look".
  Re-probing now runs in both directions. (#13)
- **A catalog invariant passed vacuously.** The test asserting that a directly-queryable object
  declares no `*Store` read `find(...)?.store`, which is `undefined` both for an entry with no
  Store and for an entry that is absent entirely — so it could not fail for a missing object,
  which is how `IdentityVerificationEvent` stayed missing. It now asserts the entry exists
  first. (#13)

### Added

- `CONTRIBUTING.md` and this changelog.
- `docs/RELEASE_TRACKING.md`: what a Salesforce release does and does not require of this
  package, the per-release checklist, and a record of each release assessed. Winter '27
  (API v68.0) is assessed and changes nothing here — no API version is pinned anywhere in
  `src/`, so the release is inert for this package. The catalog re-probe against a v68.0
  preview org remains open, and is recorded there as outstanding rather than assumed. (#13)
- README: an **Event capture** row in the capability table, which had no entry for `src/events/`
  despite it being the largest module and fully exported; the Real-Time Event base/`*Store`
  split added to the list of platform behaviours; and a statement of where the contract-test
  guarantee stops — a test can refuse a wrong read, but it cannot notice an object the catalog
  never lists. (#13)

## [0.3.0] — 2026-08-04

**Capture integrity, verified RTE catalog.**

### Fixed

- **The Real-Time Event catalog was wrong in both directions**, because it rested on a naming
  convention rather than on the platform. Probing five orgs settled it; one org would not have.
  A store that could not be read was also reported as a store containing nothing, which
  manufactured false coverage gaps on every quiet hour. (#3)

### Security

- **Presence on disk now means complete.** Captures are written atomically, so a partial file is
  never mistaken for a finished one. (#4)
- **Paths built from org data are confined.** `EventType`, object names, org ids and file ids all
  arrive from query results and were joined straight into a filesystem path. Each is now reduced
  to a single safe segment, so a value like `../../..` cannot place captured evidence outside the
  store. (#4)

## [0.2.0] — 2026-08-03

**Hourly EventLogFile and Real-Time Event capture.** Adds the event baseline store and the
hourly capture path that dependants build on.

## [0.1.x]

Initial internal releases: API clients, org context, findings model and report rendering.

[Unreleased]: https://github.com/cclabsnz/sf-core/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/cclabsnz/sf-core/releases/tag/v0.3.0
[0.2.0]: https://github.com/cclabsnz/sf-core/releases/tag/v0.2.0
