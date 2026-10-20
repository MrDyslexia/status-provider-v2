import type { StatusProvider } from "../lib/entries.js";
import { scopedAuth } from "../lib/auth-context.js";
import { fetchWithTimeout } from "../lib/http.js";

async function credential() {
  const auth = await scopedAuth.getStore()?.source();
  return auth?.anthropic;
}

/** Native v2 OAuth only. Never invokes Claude CLI, refreshes tokens or reads host credentials. */
export const nativeAnthropicProvider: StatusProvider = {
  id: "anthropic",
  isAvailable: async () => Boolean(await credential()),
  matchesCurrentModel: (model) => model.startsWith("anthropic/"),
  async fetch(ctx) {
    const auth = await credential();
    if (!auth) return { attempted: false, entries: [], errors: [] };
    if (auth.type !== "oauth" || typeof auth.access !== "string") return {
      attempted: true, entries: [], errors: [{ label: "Claude", message: "Quota requires an Anthropic OAuth connection; API-key inference does not expose subscription quota." }],
    };
    if (typeof auth.expires === "number" && auth.expires > 0 && auth.expires <= Date.now()) return {
      attempted: true, entries: [], errors: [{ label: "Claude", message: "OAuth expired; reconnect through OpenCode.", retryable: true }],
    };
    try {
      const response = await fetchWithTimeout("https://api.anthropic.com/api/oauth/usage", {
        headers: { Authorization: `Bearer ${auth.access}`, "anthropic-beta": "oauth-2025-04-20", "User-Agent": "status-provider-v2" },
      }, ctx.config.requestTimeoutMs);
      if (!response.ok) {
        const retry = Number(response.headers.get("retry-after"));
        return { attempted: true, entries: [], errors: [{ label: "Claude", message: `Quota API HTTP ${response.status}${response.status === 401 ? "; reconnect through OpenCode" : ""}`, retryable: response.status === 401 || response.status >= 500 }],
          ...(response.status === 429 ? { rateLimitedUntil: Date.now() + (Number.isFinite(retry) && retry > 0 ? retry : 60) * 1000 } : {}),
        };
      }
      const data = await response.json() as Record<string, { utilization?: number; resets_at?: string }>;
      const entries = ([ ["five_hour", "5h"], ["seven_day", "Weekly"] ] as const).flatMap(([key, label]) => {
        const window = data[key];
        return typeof window?.utilization === "number" && Number.isFinite(window.utilization)
          ? [{ name: `Claude ${label}`, group: "Claude", label: `${label}:`, percentRemaining: 100 - window.utilization, resetTimeIso: window.resets_at }]
          : [];
      });
      return { attempted: true, entries, errors: entries.length ? [] : [{ label: "Claude", message: "Quota API returned no supported windows" }] };
    } catch {
      return { attempted: true, entries: [], errors: [{ label: "Claude", message: "Quota request failed or timed out", retryable: true }] };
    }
  },
};
