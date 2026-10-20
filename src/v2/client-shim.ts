/**
 * Minimal v1-shaped client for the provider libraries.
 *
 * Providers only need two calls: `config.providers()` (which providers are
 * active) and `config.get()` (user config fragments such as the Google project
 * id). Both are answered from OpenCode v2 plugin context data.
 */

import type { StatusProviderContext } from "../lib/entries.js";
import { expandIds } from "./provider-ids.js";

export type V2StatusClient = StatusProviderContext["client"];

export interface V2ClientDeps {
  /** Active providers in the current location (`ctx.provider.list()`). */
  listProviders(): Promise<ReadonlyArray<{ readonly id: string; readonly activation?: string }>>;
  /** Optional config fragments (`model`, `provider.google.options`, ...). */
  getConfig?(): Promise<Record<string, unknown>>;
}

export function createV2StatusClient(deps: V2ClientDeps): V2StatusClient {
  return {
    config: {
      providers: async () => {
        const providers = await deps.listProviders();
        const ids = new Set<string>();
        for (const provider of providers) {
          if (provider.activation === "disabled") continue;
          for (const id of expandIds(provider.id)) ids.add(id);
        }
        return { data: { providers: [...ids].map((id) => ({ id })) } };
      },
      get: async () => {
        const data = deps.getConfig ? await deps.getConfig() : {};
        return { data } as { data?: { model?: string } };
      },
    },
  };
}
