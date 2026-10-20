# status-provider-v2

Provider quotas, reset countdowns, session usage and native TUI settings for **OpenCode 2.x**.
The implementation is verified against **OpenCode 2.0.32**. This checkout is still a private development package (`0.0.0-dev.0`), not a published npm release.

## Try the development build

Use an isolated OpenCode environment with its own configuration, database, caches and credentials. Build the checkout:

```sh
bun install --frozen-lockfile
bun run build
```

Add the absolute checkout path to that environment's `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/status-provider-v2"]
}
```

Restart OpenCode. One package entry loads both the server and TUI plugins; a separate `tui.json` entry is unnecessary. Root `server.js` and `tui.js` support the local-directory loader.

Requires Node 22+ for the CLI/build and Bun 1.3.4+ for development. SDK packages are pinned to `2.0.32`, OpenTUI to `0.5.17`, and Solid to `1.9.15`.

## Commands

| Command | Behavior |
| --- | --- |
| `/status-provider` | Show a quota toast. |
| `/status-provider-toast` | Alias for the quota toast. |
| `/status-provider-info` | Scrollable diagnostics: effective settings, availability and provider errors. |
| `/status-provider-details` | Open the native provider panel in an existing session. |
| `/status-provider-config` | Edit settings in native dialogs; save explicitly or discard with Esc. |
| `/status-provider-providers` | Open the tracked-provider dropdown when the session sidebar is visible. |

These commands do not create chat turns. The compiled CLI also supports `node dist/bin/status-provider.js show [--provider <id>]` against a running local v2 service, and `config` for the terminal wizard. `init`/`update` target the v2 package; registry installation/update requires a published release.

### Provider details

Open a session before running `/status-provider-details`.

| Keys | Action |
| --- | --- |
| Left / Right | Previous / next provider. |
| P | Search and select a provider. |
| R | Refresh the selected provider, respecting active rate-limit backoff. |
| F | Toggle fullscreen. |
| Up / Down, PageUp / PageDown, Home / End | Scroll the panel. |
| Esc | Close and return to the conversation. |

The panel shows all quota windows even when the sidebar uses `singleWindow`. Only the selected enabled provider is polled; disconnected and disabled providers have explicit states.

## Settings and presentation

Click **Status ▾** in the sidebar to expand the provider list. Click a checkbox, or navigate with Up/Down and toggle with Space/Enter. Each change immediately saves the existing global `enabledProviders` setting: unchecked providers stop being queried by the plugin's sidebar, toasts, details and CLI. This does not disable their models in OpenCode. Esc or clicking outside closes the dropdown.

**Auto-detect** restores automatic provider selection. Opening the menu only reads availability/selection metadata, not quota endpoints. Unchecked providers remain listed so they can be enabled again. If the sidebar is hidden, use `/status-provider-config` instead.

`/status-provider-config` edits the same `<config-root>/status-provider/config.json` used by the CLI. It exposes provider selection/order, percentage semantics, sidebar and compact visibility, session counters, toasts, timing and provider-specific options.

- Changes remain a draft until **Save changes**. Esc discards them.
- Updates preserve unrelated file fields and use atomic writes. A stale draft cannot overwrite a newer edit; reload before saving again.
- Globally controlled network settings remain read-only at workspace scope.
- Saving refreshes this TUI without restarting OpenCode. Other clients reconcile on their next refresh.
- The compact footer is opt-in and follows the current provider.
- Legacy ASCII styling and native-provider-status suppression are not controls in this native settings UI; existing file values are preserved for compatibility.

Quota severity always uses **remaining** quota, even if the displayed number means **used**:

| Remaining | Label |
| --- | --- |
| More than 25% | Available |
| More than 10%, up to 25% | Low |
| More than 0%, up to 10% | Critical |
| 0% or below | Exhausted |

Native theme colors accompany these labels. Authentication failures and missing data are not presented as exhausted quota. Session counters and reset countdowns update locally without polling providers every second.

## Architecture and verification

The server resolves active OpenCode integration connections and owns provider polling. Credential material never enters the TUI. The `surfaces` and `details` RPCs return whitelisted presentation data; toasts and diagnostic reports remain text. Session token counts come from the v2 SDK, with host totals preserved after compaction.

Provider caches are scoped to credential identity. Concurrent requests share work; cancelling one subscriber does not abort another subscriber's poll.

Automated coverage includes configuration validation/persistence/conflicts, account isolation, cancellation, rate limits and TUI command contracts. Browser verification covers native panels, settings save/discard, dark/light themes, small terminals, keyboard scrolling and empty/error states. See [CONTRIBUTING.md](CONTRIBUTING.md) for checks.

### Current integration limits

- OpenAI quotas are verified with a real connection in the sandbox.
- Ollama Cloud is implemented, but the sandbox credential currently receives HTTP 401; that integration remains an open validation item.
- Anthropic subscription quota requires an OAuth connection. API-key inference alone does not expose subscription quota; the adapter does not rotate credentials or invoke a separate CLI.
- Other integrations have automated provider tests; real-account verification is still needed. Optional external integrations require compatible integration/local usage sources; v1 authentication plugins are not installed automatically.

For the existing V1 implementation, use [status-provider](https://github.com/MrDyslexia/status-provider).

## Origin and license

This repository starts with an independent Git history from
[`MrDyslexia/status-provider`](https://github.com/MrDyslexia/status-provider),
commit `1e1b9092a212654404360854e70212c677070446`.
See [LINEAGE.md](LINEAGE.md) and the unchanged [MIT license](LICENSE).

The original project grew from
[`slkiser/opencode-quota`](https://github.com/slkiser/opencode-quota),
created by `slkiser` and released under the MIT License. That attribution is retained.
