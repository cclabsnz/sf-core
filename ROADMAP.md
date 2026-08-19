# Roadmap

What this project intends to do next, and what it does not intend to do. This is a statement
of current direction, not a set of commitments or dates: it is maintained by one person and
the order changes when a real org produces a surprise.

Current released version: **0.3.0**.

## Now

- **Publish provenance for every consumer.** `@cclabsnz/sf-orgintel@0.1.0` was hand-published
  before Trusted Publishing existed for that package and carries no attestation. Nothing in
  this repository blocks it, but the shared release runbook lives here, so it is tracked
  here until every package in the family is verifiable.
- **OpenSSF Best Practices at silver** across all three repositories. This repository holds
  the passing badge; the documents added alongside this one exist to close the silver gap.
- **Keep the API surface small.** Every export is a commitment to two dependants. The
  present focus is removing things that only one plugin uses rather than adding more.

## Next

- **Broaden event capture.** `EventBaselineStore` and the Real-Time Event catalog are the
  newest parts of this package and the least exercised across orgs. The intent is to widen
  the catalog only where a reading from a live org supports it, since the catalog was wrong
  in both directions the first time it was written from a naming convention.
- **Branch coverage.** Statement coverage is above 92%, but branch coverage sits near 75%.
  The gap is concentrated in error paths, which is precisely where this package's behaviour
  matters: a refused read must be distinguishable from an absent one.
- **Schema evolution rules.** The IR contracts in `src/schemas` are versioned, but the rule
  for when a version must change is currently documented in the consuming repository rather
  than here.

## Not planned

These are deliberate exclusions, recorded so nobody proposes them as oversights:

- **Any write path to a Salesforce org.** Read-only is enforced by a test that fails the
  build, and it is the property everything else in the family rests on.
- **Network calls to anywhere other than the authenticated org.** No telemetry, no
  analytics, no model APIs. Also enforced by a test.
- **Becoming an end-user tool.** This package stays a library. Commands belong in the
  plugins.
- **A plugin-specific feature with one consumer.** If only one plugin needs it, it belongs
  in that plugin.

## How to influence this

Open an issue. A concrete use case from a real org carries more weight here than a feature
request in the abstract, because the defects that have mattered in this codebase were all
found by running against real data rather than by reasoning about it.
