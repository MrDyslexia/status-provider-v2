# Changelog

## Unreleased — OpenCode v2 development

This is the development line for `status-provider-v2`, currently `0.0.0-dev.0` and private. No npm release is claimed here.

### Added

- Clickable **Status** dropdown with persistent, global provider checkboxes, auto-detection, mouse/keyboard navigation and an independent availability catalog.

- OpenCode 2.0.32 server and native TUI plugins with isolated, SDK-owned credentials.
- Structured quota snapshots, native-theme sidebar severity labels, reset countdowns and SDK session counters.
- `/status-provider-details`: all quota windows, searchable provider selection, manual refresh, fullscreen and keyboard scrolling.
- `/status-provider-config`: native settings dialogs with drafts, explicit save, discard and stale-edit conflict detection.
- Ollama Cloud balance/legacy-window support and a read-only Anthropic OAuth quota adapter.

### Changed

- CLI initialization/update use the v2 `plugins` array and one combined server/TUI package.
- CLI quota display uses the running v2 service over RPC.
- Provider caches are account-scoped; overlapping clients coalesce work and cancellation remains subscriber-local.
- Local directory installs have root `server.js`/`tui.js` entry files. V1 plugin entrypoints and SDK dependencies were removed.

### Fixed

- Explicit CLI provider filters cannot bypass globally disabled providers; settings changes do not join stale in-flight detail results.
- Provider selection catalogs retain disabled providers so they can be re-enabled without polling them.

- Optional RPC fields are omitted instead of being sent as `undefined`.
- Toast style settings are applied when configuration is reloaded.
- Session counters remain visible when no quota provider is selected.
- Page navigation is explicitly bound in detail/diagnostic views; diagnostic height adapts to short terminals.

### Validation

- Typecheck, build, 1088 tests across 119 test files, package-content checks and browser verification pass.
- Browser checks include settings persistence/cancellation, light/dark themes, reduced terminal dimensions, scrolling and provider/empty states.
- Real-account verification beyond OpenAI and the Ollama Cloud HTTP 401 remain pending integration work.
