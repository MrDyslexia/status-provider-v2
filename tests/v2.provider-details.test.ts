import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQuotaService } from "../src/v2/quota-service.js";
import { createV2StatusClient } from "../src/v2/client-shim.js";
import { DEFAULT_CONFIG } from "../src/lib/types.js";
import { __resetStatusStateForTests } from "../src/lib/status-state.js";
import type { StatusProvider, StatusProviderResult } from "../src/lib/entries.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "provider-details-"));
  vi.stubEnv("XDG_CACHE_HOME", dir);
  __resetStatusStateForTests();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function provider(id: string, available = true) {
  return {
    id, isAvailable: vi.fn(async () => available),
    fetch: vi.fn(async (): Promise<StatusProviderResult> => ({
      attempted: true,
      entries: [
        { name: "5h", group: id, label: "5h:", percentRemaining: 70, privateToken: "SECRET" } as never,
        { name: "Weekly", group: id, label: "Weekly:", percentRemaining: 30 },
      ], errors: [],
    })),
  };
}
function service(providers: StatusProvider[], config = { ...DEFAULT_CONFIG }) {
  return createQuotaService({ providers, config, roots: { fallbackDirectory: dir }, client: createV2StatusClient({ listProviders: async () => [] }) });
}

describe("provider detail RPC service", () => {
  it("shows every window regardless of sidebar singleWindow and onlyCurrentModel settings", async () => {
    const openai = provider("openai"); const other = provider("ollama-cloud");
    const svc = service([openai, other], { ...DEFAULT_CONFIG, formatStyle: "singleWindow", onlyCurrentModel: true });
    const result = await svc.details({ providerFilter: "ollama-cloud", currentProviderID: "openai", currentModel: "gpt-5" });
    expect(result.panel.entries).toHaveLength(2);
    expect(result.selectedProviderID).toBe("ollama-cloud");
    expect(openai.fetch).not.toHaveBeenCalled();
    expect(other.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
  it("prefers the current detected provider, but does not poll the others", async () => {
    const a = provider("openai"); const b = provider("ollama-cloud");
    const result = await service([a, b]).details({ currentProviderID: "ollama-cloud" });
    expect(result.providers.map((p) => p.id)).toEqual(["openai", "ollama-cloud"]);
    expect(result.selectedProviderID).toBe("ollama-cloud");
    expect(a.fetch).not.toHaveBeenCalled();
  });
  it("recognizes the current provider through a v2 integration alias", async () => {
    const a = provider("openai"); const b = provider("kimi-code");
    const result = await service([a, b]).details({ currentProviderID: "kimi-code-plan-global" });
    expect(result.selectedProviderID).toBe("kimi-code");
    expect(a.fetch).not.toHaveBeenCalled();
  });
  it("bypasses cached quota only on manual refresh", async () => {
    const selected = provider("openai"); const other = provider("ollama-cloud");
    const svc = service([selected, other]);
    await svc.details({ providerFilter: "openai" });
    await svc.details({ providerFilter: "openai" });
    expect(selected.fetch).toHaveBeenCalledTimes(1);
    await svc.details({ providerFilter: "openai", refresh: true });
    expect(selected.fetch).toHaveBeenCalledTimes(2);
    expect(other.fetch).not.toHaveBeenCalled();
  });
  it("does not poll a provider disabled by configuration", async () => {
    const a = provider("openai"); const b = provider("ollama-cloud");
    const result = await service([a, b], { ...DEFAULT_CONFIG, enabledProviders: ["openai"] }).details({ providerFilter: "ollama-cloud", refresh: true });
    expect(result.panel.status).toBe("disabled");
    expect(b.fetch).not.toHaveBeenCalled();
  });
  it("reports disconnected providers without fetching or claiming zero quota", async () => {
    const a = provider("openai", false);
    const result = await service([a]).details({ providerFilter: "openai" });
    expect(result.panel.entries).toEqual([]);
    expect(result.panel.errors[0]?.message).toContain("not detected");
    expect(a.fetch).not.toHaveBeenCalled();
  });
  it("rejects an unknown selection without querying providers", async () => {
    const a = provider("openai");
    const result = await service([a]).details({ providerFilter: "missing" });
    expect(result.selectedProviderID).toBeNull();
    expect(result.panel.errors[0]?.message).toContain("Unknown provider");
    expect(a.fetch).not.toHaveBeenCalled();
  });
  it("coalesces concurrent manual refreshes for several clients", async () => {
    const a = provider("openai"); const svc = service([a]);
    await Promise.all([svc.details({ refresh: true }), svc.details({ refresh: true }), svc.details({ refresh: true })]);
    expect(a.fetch).toHaveBeenCalledTimes(1);
  });
  it("still respects active 429 backoff when the user presses refresh", async () => {
    const a = provider("openai");
    a.fetch.mockResolvedValue({ attempted: true, entries: [], errors: [{ label: "OpenAI", message: "Rate limited" }], rateLimitedUntil: Date.now() + 60000 });
    const svc = service([a]);
    await svc.details({ refresh: true }); await svc.details({ refresh: true });
    expect(a.fetch).toHaveBeenCalledTimes(1);
  });
  it("returns a valid empty panel when there are no providers", async () => {
    expect(await service([]).details()).toMatchObject({ providers: [], selectedProviderID: null, panel: { status: "ready", entries: [], errors: [] } });
  });
});
