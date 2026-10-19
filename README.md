# status-provider-v2

Independent development repository for bringing status-provider to **OpenCode 2.x**.
This is a bootstrap, not a completed migration or an installable V2 release.

## Current status

- Application code, tests, and build tooling start from the clean V1 baseline.
- The OpenCode SDK and TUI dependencies are still the inherited V1 versions.
- No OpenCode 2.x runtime compatibility has been verified.
- npm publication is blocked with `"private": true` until release readiness is established.

**Do not install, initialize, update, or load this checkout into your active OpenCode environment.**
The inherited CLI, installer, commands, configuration paths, and caches still use
`status-provider` identities. Side-by-side installation with V1 is not supported yet.

For the existing V1 implementation, use [status-provider](https://github.com/MrDyslexia/status-provider).

## Development scope

1. Select and pin the exact OpenCode 2.x target and supported SDK contracts.
2. Migrate server hooks, authentication, tools, and provider integration.
3. Migrate TUI registration, commands, rendering, and cleanup.
4. Separate installer, CLI, configuration, and cache identities from V1.
5. Establish isolated tests and actual V2 host verification before enabling releases.

No dependency upgrade, API migration, runtime test, CI workflow, or npm release is
included in this bootstrap. See [CONTRIBUTING.md](CONTRIBUTING.md) for the inherited
checks and known fixture limitations.

## Origin and license

This repository starts with an independent Git history from
[`MrDyslexia/status-provider`](https://github.com/MrDyslexia/status-provider),
commit `1e1b9092a212654404360854e70212c677070446`.
See [LINEAGE.md](LINEAGE.md) and the unchanged [MIT license](LICENSE).

The original project grew from
[`slkiser/opencode-quota`](https://github.com/slkiser/opencode-quota),
created by `slkiser` and released under the MIT License. That attribution is retained.
