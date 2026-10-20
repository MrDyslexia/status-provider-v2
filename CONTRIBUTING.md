# Contributing to status-provider-v2

Work here targets OpenCode **2.0.32**. Keep changes consistent with its pinned SDK contracts and native TUI conventions.

## Development boundary

- Keep the V1 repository and its installed artifacts unchanged.
- Run integration checks in isolated configuration, state, caches and test credentials.
- Do not enable npm publication until the V2 migration and release checks pass.

## Checks

The project declares Bun `1.3.4`, TypeScript and Vitest. Run:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
bun run test
npm pack --dry-run
git diff --check
```

Build before testing packaging: those tests inspect the transpiled artifacts. The Solid build step compiles every TSX file in `src/v2/`; untranspiled JSX must not enter the package.

## Isolation and fixtures

Use temporary `HOME`/XDG roots for configuration and state tests. The provider result cache lives under `XDG_CACHE_HOME`, not `XDG_STATE_HOME`. Reset in-memory state as well as isolating files.

Upstream sync tests use synthetic tarball fixtures; they do not require a vendored `references/upstream-plugins` tree. Preserve upstream attribution when importing any actual third-party implementation.

## Runtime boundaries

- Resolve credentials only in the server plugin and scope them to the request.
- Keep RPC payloads explicit and omit absent optional fields rather than sending `undefined`.
- Use the shared config normalizer and `config-store.ts` for persistent settings changes.
- Keep panel keybindings scoped to panel focus. Test PageUp/PageDown explicitly; a visible scrollbar does not establish keyboard scrolling.
- Verify browser behavior alongside tests: native panels, settings save/discard, small terminals, themes and error states.

## Contribution scope

Keep behavior, regression tests, and relevant documentation together. Preserve
the license and upstream attribution. Local sandbox state, credentials and binaries under `validation-v2/` are ignored and must remain outside commits and package contents.
