# Architecture

How `@cclabsnz/sf-core` is put together, and why it is arranged this way. Read this before
changing anything that crosses a module boundary.

## What it is

A library, not a CLI plugin. It carries the common heavy lifting, so that no plugin implements
it twice and each one stays narrow:

```
     sf-audit        sf-orgintel        sf-evidence        sf-trace
    (security)       (org intel)         (archival)        (activity)
          \               |                   |                /
           ==================================================
                           @cclabsnz/sf-core
           ==================================================
                                     |
                         @salesforce/core Connection
                                     |
                           a Salesforce org  (read-only)
```

Every plugin consumes this package **from npm**, not by path. A change here must be published
before any of them can use it, and a regression reaches all of them at once.

### What belongs here, and what does not

| Question | Answer | Home |
|---|---|---|
| Is it reusable across plugins, and free of any product's opinion? | yes | here |
| Does it encode what one product thinks the data *means* — a severity, a finding, a score, a recommendation? | yes | that plugin |

This supersedes the narrower rule in `2026-08-03-hourly-rte-capture-design.md` §1, which placed
all correlation and analysis outside this package. That rule asked "is it capture?", which put
reusable, opinion-free functions on the wrong side of the line as soon as a second consumer
wanted them. Computing *what happened* belongs here; judging *what it is worth* does not.

## The one trust boundary

Everything this package does with an org goes through four client interfaces in `src/api`.
There are two transports behind the same interfaces: the `@salesforce/core` `Connection`
(`SoqlClientImpl`, `ToolingClientImpl`, `RestClientImpl`, `MetadataClientImpl`) and a
fetch-based one (`FetchSoqlClient`, `FetchToolingClient`, `FetchRestClient`, exported as
`@cclabsnz/sf-core/fetch`) for hosts that cannot carry `@salesforce/core`, such as a Lambda
bundle. `MetadataClient` has no fetch implementation.

| Client | Wraps |
| --- | --- |
| `SoqlClient` | SOQL queries against the data API |
| `ToolingClient` | Tooling API queries |
| `RestClient` | REST GETs, including the global describe |
| `MetadataClient` | Metadata API list and retrieve |

On the fetch path, `FetchTransport` is the only door to the org: every request is a bearer
GET through it (`test/unit/api/fetch/FetchTransport.test.ts`, "sends a bearer token and a GET
with no method override"). The one request that is not a GET is the OAuth token exchange in
`src/api/fetch/jwtBearer.ts`, which authenticates and writes no org data
(see [ASSURANCE_CASE.md](ASSURANCE_CASE.md), Claim 1). The fetch entry point reaches neither
`@salesforce/core` nor jsforce, including as a type import
(`test/unit/invariants/fetch-entry.test.ts`, "reaches @salesforce/core and jsforce from nowhere").

Concentrating org access in four interfaces is what makes the read-only property checkable.
`test/unit/invariants/readonly-invariant.test.ts` scans the source for org-mutating patterns
(`create`/`update`/`upsert`/`delete` on a connection, sObject, tooling or metadata handle,
bulk and composite paths, and HTTP write verbs) and fails the build if one appears. The rule
is a static scan rather than a runtime check, so it cannot be satisfied by a code path that
merely happens not to execute.

The same arrangement makes the second invariant checkable:
`network-egress.test.ts` fails the build if any source file imports a third-party HTTP client
or references a remote asset. **The only network destination is the org the operator
authenticated against.**

Everything returned across this boundary is untrusted input. Org data reaches filesystem
paths, SOQL strings and generated HTML, and each of those has a rule (see the assurance case,
[ASSURANCE_CASE.md](ASSURANCE_CASE.md)).

## Modules

| Module | Responsibility |
| --- | --- |
| `src/api` | The four read-only client interfaces, their `Connection` implementations, the fetch implementations under `src/api/fetch` (`FetchTransport`, the JWT bearer login, three clients), shared paging (`paging.ts`, which follows every page, child relationship pages included, and throws `QUERY_TOO_LARGE` past a configurable page cap rather than return a partial result), and `ApiError` (whose response mapping mirrors jsforce's `HttpApi.getError`, so both transports raise the same `errorCode`). The only place a `Connection` is touched, and the only place `fetch` is called. |
| `src/context` | `AuditContext` (the clients plus org identity, passed to everything), `AuditCache`, `OrgInfo`, `OrgMetrics`. |
| `src/platform` | Knowledge about how Salesforce behaves, independent of any one plugin: `apexRepository`, `flowRepository`, `salesforceId`, and `mapWithConcurrency`. |
| `src/events` | Event log and Real-Time Event capture: `pullEventLogs`, `pullRealtimeEvents`, `eventLogQuery`, `eventLogAccess`, `EventBaselineStore`, `CaptureManifest`. The only module that writes to disk. |
| `src/activity` | Pure analysis over captured event log rows: parse, classify as read/write/destructive/control/unknown, resolve composite requests, sessionise, segment cycles, recover motifs, flag outliers. No I/O and no org connection. |
| `src/findings` | The shared risk vocabulary (`RiskLevel`). |
| `src/renderers`, `src/report`, `src/assets` | The report shell: `esc`, branding tokens, and fonts embedded as data URIs. |
| `src/schemas` | Versioned IR contracts (the coupling graph, the landscape manifest) that the plugins read and write. |
| `src/testing` | Invariant rules and helpers, exported as `@cclabsnz/sf-core/testing` so dependants run the same checks against their own source. |

## Data flow

```
plugin command
      |
      v
build an AuditContext  ──►  api clients  ──►  org  (SOQL / Tooling / REST GET only)
      |                          |
      |                          v
      |                    platform repositories       (Apex bodies, Flow XML, ids)
      |                          |
      |                          v
      |                    plugin analysis             (lives in the plugin, not here)
      |                          |
      +──────────────────►  versioned IR (src/schemas)
                                 |
                                 v
                          report shell (esc, branding, fonts)  ──►  self-contained HTML
```

The split matters: analysis is pure and lives in the plugins, IO lives here, and the IR
between them is versioned so an artifact written by one version is readable by another.

## Two rules that are easy to break

**Paths built from org data must be confined.** `EventType`, object names, org ids and file
ids all arrive from query results and are joined into filesystem paths under the operator's
home directory. `segment()` in `EventBaselineStore` reduces each to a single safe path
segment, folding anything that is not an identifier character to `_` and turning a value that
reduces to dots into `_`, so a value like `../../..` cannot place captured evidence outside
the store.

**Presence on disk must mean complete.** Captures are written to a temp file and renamed, so
a partial file is never mistaken for a finished one. Anything that writes a capture must
preserve this; a straight `writeFileSync` to the final path does not.

## Determinism

The same input must produce the same bytes out. No `Date.now()` or `Math.random()` in a
render path, and no iteration over unordered structures. This is what lets a consumer diff
two runs and read the difference as a change in the org rather than a change in the tool.
