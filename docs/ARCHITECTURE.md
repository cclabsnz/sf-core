# Architecture

How `@cclabsnz/sf-core` is put together, and why it is arranged this way. Read this before
changing anything that crosses a module boundary.

## What it is

A library, not a CLI plugin. It provides the pieces both CloudCounsel Salesforce plugins
need, so that neither implements them twice:

```
                 sf-audit  (security audit)      sf-orgintel  (org intelligence)
                        \                              /
                         \                            /
                          ============================
                                  @cclabsnz/sf-core
                          ============================
                                        |
                            @salesforce/core Connection
                                        |
                              a Salesforce org  (read-only)
```

Both plugins consume this package **from npm**, not by path. A change here must be published
before either can use it, and a regression reaches both at once.

## The one trust boundary

Everything this package does with an org goes through four client interfaces in `src/api`:

| Client | Wraps |
| --- | --- |
| `SoqlClient` | SOQL queries against the data API |
| `ToolingClient` | Tooling API queries |
| `RestClient` | REST GETs, including the global describe |
| `MetadataClient` | Metadata API list and retrieve |

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
| `src/api` | The four read-only clients, their implementations, and `ApiError`. The only place a `Connection` is touched. |
| `src/context` | `AuditContext` (the clients plus org identity, passed to everything), `AuditCache`, `OrgInfo`, `OrgMetrics`. |
| `src/platform` | Knowledge about how Salesforce behaves, independent of any one plugin: `apexRepository`, `flowRepository`, `salesforceId`, and `mapWithConcurrency`. |
| `src/events` | Event log and Real-Time Event capture: `pullEventLogs`, `pullRealtimeEvents`, `eventLogQuery`, `eventLogAccess`, `EventBaselineStore`, `CaptureManifest`. The only module that writes to disk. |
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
