# Releasing `@cclabsnz/sf-core`

Publishing is triggered by cutting a GitHub Release. `.github/workflows/publish.yml` builds,
tests, publishes to npm **with build provenance**, and attaches a CycloneDX SBOM to the release.

No npm token is stored anywhere. Auth is npm **Trusted Publishing (OIDC)**: the job exchanges
its short-lived GitHub OIDC id-token for an npm credential at publish time. Nothing to rotate,
nothing to leak.

## One-time setup

This is required before the first release will publish, and is the single most likely reason a
release fails. On npmjs.com, go to **`@cclabsnz/sf-core` → Settings → Trusted Publishing** and
add a GitHub Actions publisher:

| Field | Value |
|---|---|
| Organization / user | `cclabsnz` |
| Repository | `sf-core` |
| Workflow filename | `publish.yml` |
| Environment | **leave blank** |

Each field is matched exactly against a claim in the OIDC token. A value that does not match —
including an environment name when the workflow declares none — makes npm decline the exchange.

This is package-level configuration, not org-level. Adding a trusted publisher to the
`@cclabsnz` org does not cover an individual package.

## Cutting a release

1. Land the work on `main` and make sure CI is green.
2. Bump `version` in `package.json`. Semver against the **exported surface**, not the internals:
   a new export or an optional field is a minor; changing the shape or optionality of something
   a consumer already reads is a major, even where TypeScript is the only thing that notices.
3. Verify locally:
   ```sh
   pnpm install --frozen-lockfile
   pnpm run build
   pnpm test
   npm pack --dry-run
   ```
   Read the `npm pack` output. The `files` allowlist in `package.json` is what keeps working
   notes and org data out of the tarball — npm does not read `.gitignore`, and it certainly does
   not read a *global* gitignore, so a directory that never appears in `git status` can still
   ship to the registry. Anything outside `lib/`, `schemas/`, `src/assets/`, `LICENSE` and
   `README.md` in that listing is a bug.
4. Cut the release. The tag convention is `v` + the exact `package.json` version:
   ```sh
   gh release create v0.2.0 --target main --title "v0.2.0 — <summary>" --notes "<notes>"
   ```
5. Watch it:
   ```sh
   gh run list --workflow=publish.yml -L 1
   ```
6. Confirm the registry actually moved. A green workflow is not proof — check the thing itself:
   ```sh
   npm view @cclabsnz/sf-core dist-tags
   ```

The npm page should show a verified *"Built and signed on GitHub Actions"* attestation linking
the tarball to the release commit.

## Re-running a failed publish

Nothing needs undoing. The tag, the release and the commit are all still correct — only the
publish step needs to run again:

```sh
gh run rerun <run-id> --failed
```

Re-run the **release-triggered** run rather than dispatching a fresh one. The SBOM attach step
is gated on `github.event_name == 'release'`, so a `workflow_dispatch` run publishes but skips
the SBOM.

A version that did publish can never be republished — npm forbids reusing a version number even
after an unpublish. If a bad tarball reaches the registry, deprecate it and ship a patch.

## Troubleshooting

**`npm error code ENEEDAUTH`** — npm found no credential. Confusingly, this is also what a
*rejected* OIDC exchange looks like: npm asks, npm is declined, npm falls back to unauthenticated
and reports it as though it never had a token to begin with. Work through, in order:

1. The trusted publisher on npmjs.com matches the table above, field for field. Environment
   blank. Workflow filename exactly `publish.yml`.
2. The publisher is on the **package**, not the org.
3. `npm -v` in the job log is ≥ 11.5.1. The runner's Node 22 ships npm 10.x, which has no OIDC
   support at all — hence the explicit upgrade step.
4. The job grants `id-token: write`. The workflow's top-level `permissions: contents: read` is a
   default; the job-level block overrides it, and the repo's read-only default workflow
   permission does not block an explicit escalation.
5. No `.npmrc` exists in the repo, and `actions/setup-node` is configured **without**
   `registry-url`. That input makes setup-node write an `.npmrc` containing a placeholder
   `_authToken`, and the placeholder takes precedence over the OIDC flow. This has bitten this
   repo before; it is why the omission is commented in the workflow.

To see whether npm attempts the exchange at all, add `--loglevel verbose` to the publish command
temporarily. A run that never mentions OIDC is a client-side problem (3–5); a run that attempts
it and is refused is a configuration mismatch (1–2).

**`E404` on publish** — usually the placeholder-`_authToken` case in (5), not a missing package.

**`EOTP`** — a 2FA prompt means npm is authenticating the request as a *user* rather than through
trusted publishing. Treat it as the same misconfiguration.

## What ships

The tarball is an allowlist, not an ignore list:

```jsonc
"files": ["/lib", "/schemas", "/src/assets", "LICENSE", "README.md", "!/lib/**/*.map"]
```

`docs/` is deliberately absent. Design notes under `docs/` routinely quote real org IDs, object
names and incident detail from live investigations, and must never reach a public registry.
