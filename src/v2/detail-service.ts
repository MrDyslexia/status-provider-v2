import { collectStatusRenderData } from "../lib/status-render-data.js";
import { createStatusProviderRuntimeContext, createStatusRuntimeRequestContext, type StatusRuntimeContext } from "../lib/status-runtime-context.js";
import { toPanelSnapshot } from "../lib/status-surfaces.js";
import { getStatusProviderDisplayLabel } from "../lib/provider-metadata.js";
import type { DetailsWire } from "./rpc.js";
import { expandIds } from "./provider-ids.js";

/** Availability discovery is local; only the selected enabled provider is polled. */
export async function buildProviderDetails(runtime: StatusRuntimeContext, options: {
  providerID?: string; refresh?: boolean; now: number;
}): Promise<DetailsWire> {
  const fullRuntime = { ...runtime, config: { ...runtime.config, onlyCurrentModel: false } };
  const ctx = createStatusProviderRuntimeContext(fullRuntime);
  const providers = await Promise.all(runtime.providers.map(async (provider) => {
    let available = false;
    try { available = await provider.isAvailable(ctx); } catch { /* An unavailable provider must not break the picker. */ }
    return {
      id: provider.id,
      label: getStatusProviderDisplayLabel(provider.id),
      available,
      enabled: runtime.config.enabled && (runtime.config.enabledProviders === "auto" || runtime.config.enabledProviders.includes(provider.id)),
    };
  }));
  const current = runtime.session.sessionMeta?.providerID;
  const currentIds = current ? expandIds(current) : [];
  const selected = options.providerID ? providers.find((p) => p.id === options.providerID)
    : providers.find((p) => currentIds.includes(p.id) && p.available && p.enabled)
      ?? providers.find((p) => p.available && p.enabled)
      ?? providers[0];
  const base = { generatedAt: options.now, providers, selectedProviderID: selected?.id ?? null };
  if (!selected) return { ...base, panel: {
    status: "ready", entries: [], errors: options.providerID ? [{ label: "Provider", message: "Unknown provider" }] : [],
  } };
  if (!selected.enabled) return { ...base, panel: { status: "disabled", entries: [], errors: [] } };
  if (!selected.available) return { ...base, panel: {
    status: "ready", entries: [], errors: [{ label: selected.label, message: "Unavailable (not detected). Connect this provider through OpenCode." }],
  } };

  const detailRuntime = {
    ...fullRuntime,
    config: { ...fullRuntime.config, formatStyle: "allWindows" as const, showSessionTokens: false, enabledProviders: [selected.id] },
    providers: fullRuntime.providers.filter((provider) => provider.id === selected.id),
    sessionTokens: null,
  };
  const result = await collectStatusRenderData({
    client: detailRuntime.client, config: detailRuntime.config, configMeta: detailRuntime.configMeta,
    request: createStatusRuntimeRequestContext(detailRuntime), providers: detailRuntime.providers,
    formatStyle: "allWindows", surfaceExplicitProviderIssues: true, bypassProviderCache: options.refresh === true,
  });
  return { ...base, panel: toPanelSnapshot({ enabled: true, result, percentDisplayMode: runtime.config.percentDisplayMode }) };
}
