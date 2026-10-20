import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQuotaService } from "../src/v2/quota-service.js";
import { createV2StatusClient } from "../src/v2/client-shim.js";
import { __resetStatusStateForTests } from "../src/lib/status-state.js";
import type { StatusProviderResult } from "../src/lib/entries.js";
import { getProviders } from "../src/providers/registry.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "provider-selection-"));
  vi.stubEnv("HOME", root); vi.stubEnv("OPENCODE_CONFIG_DIR", root);
  vi.stubEnv("XDG_CONFIG_HOME", root); vi.stubEnv("XDG_CACHE_HOME", root);
  vi.stubEnv("XDG_DATA_HOME", root); vi.stubEnv("XDG_STATE_HOME", root);
  __resetStatusStateForTests();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function provider(id: string, available = true) {
  return { id, isAvailable: vi.fn(async () => available), fetch: vi.fn(async (): Promise<StatusProviderResult> => ({ attempted: true, entries: [{ name: id, percentRemaining: 50 }], errors: [] })) };
}
function setup() {
  const openai = provider("openai"), ollama = provider("ollama-cloud"), copilot = provider("copilot", false);
  const service = createQuotaService({
    providers: [openai, ollama, copilot], roots: { fallbackDirectory: root },
    client: createV2StatusClient({ listProviders: async () => [] }),
  });
  const save = async (ids: string[] | "auto") => {
    const settings = await service.getSettings();
    await service.saveSettings({ revision: settings.revision, changes: [{ key: "enabledProviders", value: ids }] });
  };
  return { service, save, openai, ollama, copilot };
}

describe("global provider checkboxes", () => {
  it("keeps the complete real registry visible after an explicit selection filters the polling list", async () => {
    const fetch = vi.fn(async () => { throw new Error("catalog must not use network"); }); vi.stubGlobal("fetch", fetch);
    const service = createQuotaService({ roots: { fallbackDirectory: root }, client: createV2StatusClient({ listProviders: async () => [] }) });
    const snapshot = await service.getSettings();
    await service.saveSettings({ revision: snapshot.revision, changes: [{ key: "enabledProviders", value: ["openai"] }] });
    const menu = await service.providerSelection();
    expect(menu.providers).toHaveLength(getProviders().length);
    expect(menu.providers.some((p) => p.id === "ollama-cloud" && !p.enabled)).toBe(true);
    expect(menu.selected).toEqual(["openai"]); expect(fetch).not.toHaveBeenCalled();
  });
  it("lists all providers and auto-detected checks without fetching any quota", async () => {
    const { service, openai, ollama, copilot } = setup();
    const menu = await service.providerSelection();
    expect(menu.mode).toBe("auto"); expect(menu.selected).toEqual(["openai", "ollama-cloud"]);
    expect(menu.providers).toHaveLength(3);
    for (const p of [openai, ollama, copilot]) expect(p.fetch).not.toHaveBeenCalled();
  });
  it("reflects the existing providerOrder restriction in automatic mode", async () => {
    const { service } = setup(); const snapshot = await service.getSettings();
    await service.saveSettings({ revision: snapshot.revision, changes: [{ key: "providerOrder", value: ["openai"] }] });
    const menu = await service.providerSelection();
    expect(menu.mode).toBe("auto"); expect(menu.selected).toEqual(["openai"]);
    expect(menu.providers.some((provider) => provider.id === "ollama-cloud")).toBe(true);
  });
  it("uses the same persisted enabledProviders as configuration and all quota surfaces", async () => {
    const { service, save, openai, ollama } = setup();
    await save(["openai"]);
    expect(await service.providerSelection()).toMatchObject({ mode: "manual", selected: ["openai"] });
    await service.surfaces(); await service.toast(); await service.info();
    await service.details({ providerFilter: "ollama-cloud", refresh: true });
    await service.toast({ providerFilter: "ollama-cloud" });
    await service.surfaces({ providerFilter: "ollama-cloud" });
    expect(openai.fetch).toHaveBeenCalled(); expect(ollama.fetch).not.toHaveBeenCalled();
  });
  it("allows all providers to be unchecked and later restored to auto detection", async () => {
    const { service, save, openai, ollama } = setup();
    await save([]);
    expect((await service.surfaces()).sidebar.entries).toEqual([]);
    await service.toast({ providerFilter: "openai" });
    expect(openai.fetch).not.toHaveBeenCalled(); expect(ollama.fetch).not.toHaveBeenCalled();
    await save("auto");
    expect((await service.providerSelection()).selected).toEqual(["openai", "ollama-cloud"]);
  });
  it("does not reset provider rate-limit backoff when checkbox settings are saved", async () => {
    const { service, save, openai } = setup();
    openai.fetch.mockResolvedValue({ attempted: true, entries: [], errors: [{ label: "OpenAI", message: "Rate limited" }], rateLimitedUntil: Date.now() + 60000 });
    await service.details({ providerFilter: "openai", refresh: true });
    await save(["openai"]);
    await service.details({ providerFilter: "openai", refresh: true });
    expect(openai.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not join an old in-flight details request after settings disable that provider", async () => {
    const { service, save, openai } = setup();
    let finish!: (result: StatusProviderResult) => void;
    openai.fetch.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const old = service.details({ providerFilter: "openai", refresh: true });
    await vi.waitFor(() => expect(openai.fetch).toHaveBeenCalledTimes(1));
    await save([]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        service.details({ providerFilter: "openai", refresh: true }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("joined disabled provider poll")), 500); }),
      ]);
      expect(result.panel.status).toBe("disabled");
    } finally {
      clearTimeout(timer); finish({ attempted: true, entries: [], errors: [] }); await old;
    }
    expect(openai.fetch).toHaveBeenCalledTimes(1);
  });
});
