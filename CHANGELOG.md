# Changelog

All notable changes to `@cclabsnz/sf-core` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely, and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each released entry mirrors the [GitHub Release](https://github.com/cclabsnz/sf-core/releases)
for that tag, which is the canonical published note and carries the provenance attestation and
CycloneDX SBOM for the build.

## [Unreleased]

Nothing yet.

## [0.5.1] — 2026-09-09

### Fixed

- **The unsupported-schema-version finding offered a remedy that does not exist.** Its `fix` read
  "Re-extract the graph with this version of the tool, or run the migration to 1.2.0", and no
  migration was ever written — `docs/` in the consuming repo explicitly declines to write one. A
  reader hitting it went looking for a command that is not there, unsure whether they had missed a
  step or the tool was wrong.

  It survived because it was unreachable. `SUPPORTED_GRAPH_SCHEMA_VERSION` was set once and never
  moved, so no document could disagree with it and the finding could not fire; 0.5.0's bump to
  `1.2.0` was the first thing that made it reachable, in the same release that first published it
  to a second consumer. The existing test asserted only that `fix` was non-empty, which is the
  letter of that field's contract — "a finding a reader cannot act on is a bug report" — and could
  not tell an action apart from a promise. A test now pins that the fix does not direct anyone to
  run a migration, while still allowing it to say that none exists, which is worth saying.

## [0.5.0] — 2026-09-09

**The canonical org graph, and a merge that refuses to state something false.**

### Added

- **The canonical org graph.** `CanonicalGraph`, `GraphNode`/`GraphEdge`, `GRAPH_SCHEMA`,
  `validateGraph`, `GRAPH_KIND_TABLE` and the `GRAPH_RULES` codes, moved here from the
  `sf-orgviz` plugin that owned them. Two tools can now produce fragments of one schema without
  either depending on the other. `GRAPH_KIND_TABLE` declares which producer owns each node kind,
  so the split is enforced rather than documented — ownership is per kind and not per layer
  because node ids are `prefix.name`, which makes disjoint kinds the thing that actually keeps
  ids disjoint.
- **`mergeGraphs(fragments)`.** Unions fragments and refuses the merge when it would state
  something false: fragments from different orgs, fragments at different schema versions, one
  node id claimed twice, or a producer emitting a kind it does not own. A rejection returns no
  graph at all, because a partial merge that still looks like a complete picture is worse than
  none. `capturedAt` on a merged graph is the **oldest** fragment's — a merged picture is only as
  fresh as its stalest part, and taking the newest would let a fresh run make a stale one look
  current — and coverage is unioned, so a fact one producer could not read stays unread after
  merging with one that could.
- **Attribute contributions.** A producer may state a measurement about a node another producer
  owns, applied under the contributor's own namespace so that who asserted a value stays
  answerable and two producers writing one key cannot become a silent last-writer-wins. An
  unresolved contribution is reported rather than fatal: it means a fragment is missing, not that
  the graph is wrong.
- **`roleOf(objectName)`.** The seven-role Salesforce object classifier, ported from
  `sf-orgintel`, returning the already-published `ObjectLayer`. Renamed from `layerOf` on the way
  in, because this package also exports `layerOfKind`, which classifies on an entirely different
  axis.

### Changed

- `ajv` moved from a development dependency to a runtime one. The graph validator ships from here
  now, so consumers receive it transitively; this package previously declared no runtime
  dependencies at all. The existing `fast-uri@3` override, which exists because of ajv's own
  dependency chain, is unchanged.

## [0.4.0] — 2026-09-09

**Four missing Real-Time Event objects, and triage that matches what ships.**

Minor rather than patch: a consumer that changes nothing now captures four event
types it did not capture before, so output moves under it. The exported surface is
unchanged.

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
- **The Socket triage claimed something untrue of this package.** `socket.yml` stated that it
  "makes no outbound network call of its own". `src/api/RestClientImpl.ts` calls global
  `fetch` to stream an EventLogFile download, which is why Socket reports network access and
  records `net: true`. The surrounding sentences were right about the destination, so the
  claim read as true while the sentence carrying it was false — the worst shape for a
  statement a reviewer is invited to verify. It now says what the call is: one `fetch`, to
  the instance URL of an org the caller already authenticated against, on the caller's own
  session. The OFL-1.1 licence alert, previously unanswered, is answered in the same place:
  it describes the bundled fonts, not the code, which stays Apache-2.0. Neither rule is
  suppressed. (#15)

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

[Unreleased]: https://github.com/cclabsnz/sf-core/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/cclabsnz/sf-core/releases/tag/v0.4.0
[0.3.0]: https://github.com/cclabsnz/sf-core/releases/tag/v0.3.0
[0.2.0]: https://github.com/cclabsnz/sf-core/releases/tag/v0.2.0
