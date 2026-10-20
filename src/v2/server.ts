/**
 * status-provider server plugin for OpenCode v2.
 *
 * Sole owner of credential access and provider polling. Clients (TUI, CLI)
 * receive sanitized snapshots over RPC.
 */

import { Plugin } from "@opencode/plugin";
import type { SessionID } from "@opencode/client";
import { createHash } from "node:crypto";

import { withAuthSource } from "../lib/opencode-auth.js";
import { buildAuthData } from "./auth-adapter.js";
import { createV2StatusClient } from "./client-shim.js";
import { createQuotaService, type DetailRequest, type SurfaceRequest } from "./quota-service.js";
import { StatusProviderRpc } from "./rpc.js";
import { summarizeSessionUsage } from "./session-usage.js";
import { waitForResult } from "./tui-controller.js";
import { recordLocalCompletion } from "./local-usage.js";
import { loadConfig } from "../lib/config.js";
import type { SettingsUpdate } from "./settings-model.js";

export const PLUGIN_ID = "status-provider";

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const authSource = () =>
      buildAuthData({
        list: async () => (await ctx.integration.list()).data,
        active: (integrationID) => ctx.integration.connection.active(integrationID),
        resolve: (connection) => ctx.integration.connection.resolve(connection),
      }, { exclude: new Set() });
    const lifecycle = new AbortController();
    let revision = 0;
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: lifecycle.signal })) {
          if (event.type.startsWith("credential.")) revision++;
          if (event.type === "session.step.ended" && event.data.finish !== "error") {
            try {
              const session = await ctx.session.get({ sessionID: event.data.sessionID });
              if (String(session.location.directory) !== String(ctx.location.directory)) continue;
              const providerID = session.model?.providerID;
              if (!providerID || !["qwen-code", "alibaba", "alibaba-coding-plan"].includes(providerID)) continue;
              const config = await loadConfig(undefined, undefined, { configRootDir: process.env.OPENCODE_CONFIG_DIR ?? String(ctx.location.directory) });
              await recordLocalCompletion(providerID, await authSource(), config.enabled);
            } catch { /* Usage estimation must not interrupt inference or credential events. */ }
          }
        }
      } catch { /* The next request resolves credentials again, even if the event stream disconnects. */ }
    })();

    const client = createV2StatusClient({
      listProviders: async () => (await ctx.provider.list()).data,
    });

    const directory = String(ctx.location.directory);
    const service = createQuotaService({
      sessionUsage: async (sessionID) => {
        const input = { sessionID: sessionID as SessionID };
        const [messages, session] = await Promise.all([ctx.session.context(input), ctx.session.get(input)]);
        return summarizeSessionUsage(messages, session.tokens);
      },
      client,
      roots: { workspaceRoot: directory, activeDirectory: directory, fallbackDirectory: directory },
    });

    const run = async <T,>(signal: AbortSignal, fn: () => Promise<T>) => {
      signal.throwIfAborted();
      const auth = await authSource();
      const identity = createHash("sha256").update(JSON.stringify(auth)).update(String(revision)).digest("hex");
      return withAuthSource(async () => auth, identity, async () => {
        signal.throwIfAborted();
        const result = await waitForResult(fn(), signal);
        signal.throwIfAborted();
        return result;
      }, lifecycle.signal);
    };
    const registration = await ctx.rpc.register(StatusProviderRpc, {
      settingsRead: async () => service.getSettings(),
      settingsSave: async (input, call) => {
        try {
          call.signal.throwIfAborted();
          await service.saveSettings(input as SettingsUpdate);
          return { saved: true };
        } catch (error) {
          return call.error("settings_error", error instanceof Error ? error.message : "Could not save settings", null);
        }
      },
      details: async (input, call) => run(call.signal, () => service.details((input ?? {}) as DetailRequest)),
      surfaces: async (input, call) => run(call.signal, () => service.surfaces((input ?? {}) as SurfaceRequest)),
      toast: async (input, call) => run(call.signal, () => service.toast((input ?? {}) as SurfaceRequest)),
      info: async (input, call) => run(call.signal, () => service.info((input ?? {}) as SurfaceRequest)),
    });

    return async () => {
      service.dispose();
      lifecycle.abort();
      await registration.dispose();
    };
  },
});
