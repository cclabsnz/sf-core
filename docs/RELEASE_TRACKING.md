# Tracking a Salesforce release

Three times a year Salesforce ships a release and every API version in the platform moves.
This document is what to do about it in `sf-core`, and — more usefully — what *not* to bother
doing, because the answer is smaller than it first appears.

## Why most of a release is a no-op here

Nothing in `src/` pins an API version. `RestClientImpl` and `ToolingClientImpl` build their
paths from `conn.getApiVersion()`, so the version is whatever the caller's `Connection` is
already using, and `pullRealtimeEvents` probes `describe` rather than trusting a static table.
A release that adds objects, adds fields or bumps the version number therefore requires no
change at all. The `62.0`/`67.0` strings in `test/unit/api/` are fixture values chosen to make
an assertion readable; they are not pins, and nothing breaks if they go stale.

What *is* release-coupled is the knowledge data — the tables that encode what a real org does:

| File | What is coupled | How it fails |
| --- | --- | --- |
| `src/events/rteCatalog.ts` | which RTE objects exist, and the base/Store split | **silently** |
| `src/events/eventLogQuery.ts` (`HOURLY_FORENSIC_CORE`) | EventLogFile EventType names | silently |
| `src/platform/flowRepository.ts`, `apexRepository.ts` | which API serves which object, which columns exist | loudly, at query time |

The distinction in that last column is the whole reason this document exists. A wrong entry
in the catalog announces itself: the pull 404s, or the query is refused, and someone
investigates. A **missing** entry announces nothing. The pull simply never asks for the
object, the manifest never records it, and a consumer reads the resulting absence as "this
org had no such events" rather than "we did not look". That is the failure this package is
supposed to make impossible, so it is the one worth spending a probe on.

## The per-release checklist

1. **Read the API section of the release notes**, not the whole thing. Only these matter:
   new or retired EventLogFile EventTypes, new Real-Time Event Monitoring objects, changes to
   Tooling API objects this package reads (`FlowDefinitionView`, `Flow`, `ApexClass`,
   `ApexTrigger`), and any SOQL or REST change that alters existing semantics rather than
   adding to them. Additive and beta features are almost never actionable here.
2. **Check whether a platform quirk was fixed.** The list in the README — `Flow.Metadata`
   being one row per query, `ApexTrigger` having no `SymbolTable`, `expr0` being reserved —
   is a set of workarounds. A release that fixes one turns its workaround into dead weight,
   and nothing will fail to tell you.
3. **Check `@salesforce/core` for a new major.** A new sf CLI major usually lands alongside a
   release. If one has, widen the `peerDependencies` range only after the majors are
   confirmed compatible; the range is a compatibility claim, not a wish.
4. **Re-probe the catalogs against a live org on the new version** — see below. This is the
   only step that produces evidence rather than an opinion.
5. **Record the outcome**, including "nothing changed". A release that was checked and found
   inert is a materially different state from a release nobody looked at, and six months
   later only a written record can tell them apart.

## Probing, and the direction that matters

Run the probe **both ways**.

The forward direction — does every object the catalog declares still behave as declared —
is the obvious one, and it has never yet found anything. The inverse direction — what does
`describe` return that the catalog does *not* list — is the one that pays. It is the only
check that can catch a silent omission, and it has now found something on both occasions it
was run.

A global `describe` is enough for both, and it is one read per org:

```
GET /services/data/vXX.0/sobjects/
```

Compare the `name` and `queryable` flags against `RTE_CATALOG`, in both directions. Read-only
throughout: no step here writes to an org, and none should be added that does.

Two rules learned the hard way, both still worth obeying:

- **Believe the org, not the name.** The catalog was first written from a naming convention
  and the convention was wrong in both directions. Whether an object is queryable directly or
  only through a `*Store` cannot be derived from its name.
- **One org is not evidence.** Licensing differences change what `describe` returns, so a
  verdict — especially a negative one — needs agreement across several orgs before it earns
  a place in the table. Probe production and non-production alike; they differ.

## Record

### Winter '27 (API v68.0)

Assessed 2026-09-02, against the release notes and eight orgs on v67.0.

| Change | Impact on this package |
| --- | --- |
| `FORMULA()` in a SOQL `WHERE` clause (beta) | None. Additive, and not available in production orgs |
| Platform API versions 31.0–40.0 retired (deprecated Summer '27, calls fail Summer '28) | None. No version is pinned, and the supported `@salesforce/core` majors default far above 40.0 |
| Streaming API replay watermark in `ext.replay` | None. This package reads retained `*Store` rows, never the streaming channel |
| SOAP login endpoint retirement | None. Authentication is delegated to `@salesforce/core` |
| `CompositeApi` and `CompositeApiSubrequest` EventLogFile types documented (API v64.0+) | Noted, not adopted — see open items |

No Event Monitoring changes appear in the Winter '27 security notes, and no new RTE object
was announced.

The re-probe across eight orgs confirmed every existing catalog verdict unchanged, and the
inverse probe found four objects the catalog had never listed: `LoginAnomalyEvent`,
`UniversalAnomalyEvent`, `IdentityVerificationEvent` and `ApiPrtcPolicyChangeEvent`. All four
are now declared. They were **not** introduced by Winter '27 — they were present on v67.0 and
almost certainly earlier, which is precisely the point about silent omission.

## Open items

- **The v68.0 probe has not been run.** No org available at the time of writing served an API
  version above 67.0, and none was on a preview instance. Until the catalogs are re-probed
  against a sandbox on v68.0, the Winter '27 assessment above rests on release notes alone —
  which this package's own history says is the weaker kind of evidence. Re-run the probe once
  a preview org exists and update the record.
- **`HOURLY_FORENSIC_CORE` omits `CompositeApi` and `CompositeApiSubrequest`.** Both were
  present in every production org probed, and composite requests can read records in bulk, so
  they are exfiltration-relevant. They are deliberately not added: that list is short on
  purpose, because hourly capture of every type costs roughly an order of magnitude more
  storage than the current set. Adding them is a cost decision for the consuming plugins to
  make, not a defect to fix here.
- **Nothing enforces a minimum API version.** A consumer connecting with an old
  `Connection` would have this package emit calls against it silently. Harmless today, but
  the 31.0–40.0 retirement is the first time that has had a deadline attached.
