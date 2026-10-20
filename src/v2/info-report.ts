import type { StatusRuntimeContext } from "../lib/status-runtime-context.js";
import { createStatusProviderRuntimeContext, createStatusRuntimeRequestContext } from "../lib/status-runtime-context.js";
import { collectStatusStatusLiveProbes, matchesStatusProviderCurrentSelection } from "../lib/status-render-data.js";
import { sanitizeDisplayText } from "../lib/display-sanitize.js";

/** Server-owned diagnostics: no legacy auth-file inspection or credential serialization. */
export async function buildV2InfoReport(runtime: StatusRuntimeContext): Promise<string> {
  const context = createStatusProviderRuntimeContext(runtime);
  const selection = runtime.session.sessionMeta;
  const availability = await Promise.all(runtime.providers.map(async (provider) => {
    let available = false;
    let failed = false;
    try {
      available = await provider.isAvailable(context);
    } catch {
      failed = true;
    }
    const enabled = runtime.config.enabledProviders === "auto"
      ? available
      : runtime.config.enabledProviders.includes(provider.id);
    return { provider, available, enabled, failed };
  }));

  const probes = runtime.config.enabled ? await collectStatusStatusLiveProbes({
    client: runtime.client,
    config: runtime.config,
    configMeta: runtime.configMeta,
    request: createStatusRuntimeRequestContext(runtime),
    providers: availability.filter((item) => item.enabled && item.available).map((item) => item.provider),
  }) : [];
  const byId = new Map(probes.map((probe) => [probe.providerId, probe.result]));

  const lines = [
    "Status Provider — OpenCode v2",
    "",
    `Plugin: ${runtime.config.enabled ? "enabled" : "disabled"}`,
    `Config source: ${runtime.configMeta.source ?? "defaults"}`,
    `Config root: ${runtime.roots.configRoot}`,
    `Provider selection: ${runtime.config.enabledProviders === "auto" ? "auto" : runtime.config.enabledProviders.join(", ")}`,
    `Current provider: ${selection?.providerID ?? "not selected"}`,
    `Current model: ${selection?.modelID ?? "not selected"}`,
    `Session: ${runtime.session.sessionID ?? "none"}`,
    `Session tokens: ${runtime.sessionTokens ? `${runtime.sessionTokens.totalInput} input, ${runtime.sessionTokens.totalCachedInput ?? 0} cached, ${runtime.sessionTokens.totalOutput} output` : "not available or disabled"}`,
    "Credentials: OpenCode integration connections (server-side)",
    "Anthropic: native OAuth only; refresh is owned by OpenCode",
    "",
    "Providers",
  ];
  for (const item of availability) {
    const matches = matchesStatusProviderCurrentSelection({
      provider: item.provider,
      currentModel: selection?.modelID,
      currentProviderID: selection?.providerID,
      enabledProviders: runtime.config.enabledProviders,
    });
    lines.push(`${item.provider.id}: ${item.enabled ? "enabled" : "disabled"}, ${item.available ? "available" : "unavailable"}${matches ? ", current" : ""}`);
    if (item.failed) lines.push("  Availability check failed");
    const result = byId.get(item.provider.id);
    if (!result) continue;
    for (const entry of result.entries) {
      const value = entry.kind === "value" ? entry.value : `${entry.percentRemaining}% remaining`;
      lines.push(`  ${entry.name}: ${value}${entry.resetTimeIso ? `; reset ${entry.resetTimeIso}` : ""}`);
    }
    for (const error of result.errors) lines.push(`  Error: ${error.message}`);
    if (!result.entries.length && !result.errors.length) lines.push("  No quota data returned");
  }
  if (!availability.length) lines.push("No providers registered");

  // Only display fields are forwarded; never stringify a credential or raw provider result.
  return lines.map((line) => sanitizeDisplayText(line)).join("\n");
}
