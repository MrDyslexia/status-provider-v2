# Contributing to status-provider-v2

Work here targets OpenCode 2.x. The initial import remains V1 code and must not
be treated as a working V2 plugin.

## Development boundary

- Keep the V1 repository and its installed artifacts unchanged.
- Do not run the inherited CLI's installation, initialization, update, authentication,
  or provider commands against a live user environment.
- Use isolated configuration, state, caches, and test credentials for future work.
- Do not enable npm publication until the V2 migration and release checks pass.

## Inherited tooling

The baseline declares Bun `1.3.4`, TypeScript, and Vitest. The SDK and TUI versions
are intentionally unchanged; they are not declarations of V2 compatibility.

Once dependency installation and test isolation have been reviewed, the inherited
checks are:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build:check
bun run test
```

These commands have not been run for this new repository during bootstrap.
Historical V1 results do not establish V2 correctness.

## Known test-fixture gaps

Vendor reference snapshots were intentionally not imported. In particular,
`tests/pricing-resolver.coverage.test.ts` and
`tests/upstream.cursor-oauth.reference.test.ts` read files under
`references/upstream-plugins/` that are absent here. Review fixture ownership,
licensing, and isolation before restoring those inputs. Do not hide the failures
by silently skipping tests or claiming that the full suite passes.

Other inherited tests and tooling still assert V1 package, CLI, and installer
identities. Update them alongside the corresponding V2 behavior, not as a
metadata-only replacement.

## Contribution scope

Keep behavior, regression tests, and relevant documentation together. Preserve
the license and upstream attribution. No CI, release automation, or sandbox
infrastructure is configured by this bootstrap.
