# @cclabsnz/sf-core

> Shared platform layer for the CloudCounsel Salesforce `sf` plugins.

The read-only API surface, platform-behaviour knowledge, report shell and versioned IR
contracts behind [`@cclabsnz/sf-audit`](https://www.npmjs.com/package/@cclabsnz/sf-audit)
(security auditing) and `@cclabsnz/sf-orgintel` (org intelligence).

## What's in it

| Area | What it provides |
| --- | --- |
| **API clients** | `SoqlClient`, `ToolingClient`, `RestClient`, `MetadataClient`: read-only wrappers over a `@salesforce/core` `Connection` |
| **Platform behaviour** | `FlowRepository`, `ApexRepository`, `isSalesforceId`, `describeSalesforceError`, `mapWithConcurrency` |
| **IR contracts** | Typed interfaces plus JSON Schemas for `coupling-graph`, `landscape-manifest` and `process-graph` |
| **Report shell** | Branding resolution and embedded webfonts for self-contained HTML reports |
| **Test invariants** | Static guards that fail a build on org writes or network egress |

## Why the platform layer exists

Salesforce has behaviours that are easy to get wrong and expensive to discover, and each one
here was learned by running against a real org:

- `FlowDefinitionView` is a **standard** object, so querying it through Tooling answers
  *"sObject type 'FlowDefinitionView' is not supported."*
- `Flow.Metadata` **is** Tooling, and is strictly **one row per query**. An `Id IN (...)`
  batch is rejected outright, so bulk reads need bounded concurrency.
- `ApexClass` has a `SymbolTable` column; **`ApexTrigger` does not**, and selecting it fails the
  entire query.
- Managed-package flows return a **durable name** (`ns__Flow-1`) where an Id is expected;
  feeding that to a `WHERE` clause yields `invalid ID field`.
- `expr0` is Salesforce's own aggregate alias and **cannot be requested**. An explicit
  `COUNT(Id) expr0` is rejected with *"alias is reserved: expr0"*.

Encoding these once means a consumer cannot rediscover them by shipping the bug first. The
contract tests are the point: their mocks refuse exactly as an org refuses, so a query sent to
the wrong API or asking for a non-existent column fails the build rather than degrading
silently in production.

## Install

```bash
pnpm add @cclabsnz/sf-core
```

## Usage

```ts
import { FlowRepository, ApexRepository, mapWithConcurrency } from '@cclabsnz/sf-core';

const flows = new FlowRepository(soqlClient, toolingClient);
const definitions = await flows.listDefinitions();
const { versions, managedSkipped } = FlowRepository.selectVersions(definitions);

// Flow.Metadata is one row per query; concurrency is the only lever.
await mapWithConcurrency(versions, 8, async (v) => {
  const metadata = await flows.fetchMetadata(v.id);
  // ...
});
```

JSON Schemas are reachable as a subpath export:

```ts
import { loadSchema, schemaPath } from '@cclabsnz/sf-core';
const couplingGraphSchema = loadSchema('coupling-graph');
```

## Guarantees

Both are enforced as tests, not asserted in prose. Run them yourself with `pnpm test`:

- **Read-only.** No jsforce mutation API, HTTP write verb, or bulk/composite write path may
  appear in source. Every org request is a SOQL query, a REST **GET**, or a Metadata read.
- **Local-first.** No third-party HTTP client, telemetry endpoint, LLM call, websocket, or
  remote asset in a generated report. The only network destination is the org the operator
  authenticated against.

## Versioning

The IR contracts (`coupling-graph`, `landscape-manifest`, `process-graph`) carry an explicit
`version` field and are the stable product surface. A breaking change to their shape is a
version bump on the contract, not a silent edit.

## Licence

Apache-2.0, see [LICENSE](LICENSE). Bundled fonts are SIL OFL 1.1; see
[`src/assets/fonts/NOTICE.md`](src/assets/fonts/NOTICE.md).
