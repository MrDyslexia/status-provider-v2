import { beforeEach, describe, expect, it, vi } from "vitest";

import { createQuotaService } from "../src/v2/quota-service.js";
import { createV2StatusClient } from "../src/v2/client-shim.js";
import { DEFAULT_CONFIG } from "../src/lib/types.js";
import type { StatusProvider } from "../src/lib/entries.js";
import { clearCache } from "../src/lib/cache.js";

const client = createV2StatusClient({ listProviders: async () => [] });
const roots = { fallbackDirectory: "/tmp/sp-v2-test" };

function fakeProvider(id: string, fetch = vi.fn()): StatusProvider & { fetch: ReturnType<typeof vi.fn> } {
  fetch.mockImplementation(async () => ({
    attempted: true,
    entries: [
      {
        name: id,
        percentRemaining: 42,
        resetTimeIso: "2030-01-01T00:00:00.000Z",
        // Not part of the entry contract; must never be rendered.
        accessToken: "SECRET",
      },
    ],
    errors: [],
  }));
  return { id, isAvailable: async () => true, fetch };
}

function service(providers: StatusProvider[], config = { ...DEFAULT_CONFIG }) {
  return createQuotaService({ client, roots, config, providers });
}

beforeEach(() => clearCache());

describe("quota service surfaces", () => {
  it("renders sidebar lines from provider data", async () => {
    const result = await service([fakeProvider("openai")]).surfaces();

    expect(result.sidebar.status).toBe("ready");
    expect(result.sidebar.lines.length).toBeGreaterThan(0);
    expect(result.sidebar.lines.join("\n")).toContain("42");
  });

  it("renders the compact line for the active model's provider", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      tuiCompactStatus: { ...DEFAULT_CONFIG.tuiCompactStatus, enabled: true, sessionPrompt: true },
    };
    const result = await service([fakeProvider("openai")], config).surfaces({
      currentProviderID: "openai",
      currentModel: "gpt-5",
    });
    expect(result.compact.status).toBe("ready");
  });

  it("only ever returns text, never credential-like data", async () => {
    const result = await service([fakeProvider("openai")]).surfaces();
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("never serves anthropic", async () => {
    const anthropic = fakeProvider("anthropic");
    const result = await service([anthropic, fakeProvider("openai")]).surfaces();

    expect(anthropic.fetch).not.toHaveBeenCalled();
    expect(result.sidebar.lines.join("\n")).toContain("42");
  });

  it("coalesces concurrent surface requests into a single poll", async () => {
    const openai = fakeProvider("openai");
    const svc = service([openai]);

    await Promise.all([svc.surfaces(), svc.surfaces(), svc.surfaces()]);

    // sidebar + compact both read the provider once through the shared cache.
    expect(openai.fetch.mock.calls.length).toBeLessThanOrEqual(2);
    const first = openai.fetch.mock.calls.length;
    await svc.surfaces();
    expect(openai.fetch.mock.calls.length).toBe(first);
  });

  it("is disabled when the plugin is disabled", async () => {
    const result = await service([fakeProvider("openai")], { ...DEFAULT_CONFIG, enabled: false }).surfaces();
    expect(result.sidebar.status).toBe("disabled");
    expect(result.compact.status).toBe("disabled");
  });

  it("rejects after dispose", async () => {
    const svc = service([fakeProvider("openai")]);
    svc.dispose();
    await expect(svc.surfaces()).rejects.toThrow(/disposed/);
  });
});

describe("quota service toast", () => {
  it("honors automatic trigger switches while keeping the manual command available", async () => {
    const svc = service([fakeProvider("openai")], { ...DEFAULT_CONFIG, enableToast: false });
    expect((await svc.toast({ trigger: "idle" })).toast).toBeNull();
    expect((await svc.toast({ trigger: "manual" })).toast?.message).toContain("42");
  });
  it("uses homeBottom independently of sessionPrompt", async () => {
    const config = { ...DEFAULT_CONFIG, tuiCompactStatus: { ...DEFAULT_CONFIG.tuiCompactStatus, enabled: true, homeBottom: true, sessionPrompt: false } };
    const svc = service([fakeProvider("openai")], config);
    expect((await svc.surfaces({ surface: "session", currentProviderID: "openai" })).compact.status).toBe("disabled");
    expect((await svc.surfaces({ surface: "home", currentProviderID: "openai" })).compact.status).toBe("ready");
  });
  it("gets session tokens from the injected SDK source", async () => {
    const usage = vi.fn(async () => ({ models: [{ modelID: "openai/gpt-5", input: 123, output: 45 }], totalInput: 123, totalOutput: 45 }));
    const svc = createQuotaService({ client, roots, config: { ...DEFAULT_CONFIG, showSessionTokens: true }, providers: [fakeProvider("openai")], sessionUsage: usage });
    const result = await svc.toast({ sessionID: "v2-session" });
    expect(usage).toHaveBeenCalledWith("v2-session");
    expect(result.toast?.message).toContain("123");
  });
  it("supports an explicit CLI provider filter", async () => {
    const first = fakeProvider("openai"); const other = fakeProvider("ollama-cloud");
    const result = await service([first, other]).toast({ providerFilter: "openai" });
    expect(result.toast?.message).toContain("openai");
    expect(other.fetch).not.toHaveBeenCalled();
  });
  it("builds the manual toast and bypasses the cache", async () => {
    const openai = fakeProvider("openai");
    const svc = service([openai]);

    await svc.surfaces();
    const before = openai.fetch.mock.calls.length;
    const result = await svc.toast();

    expect(result.toast?.message).toContain("42");
    expect(result.toast?.duration).toBeGreaterThan(0);
    expect(openai.fetch.mock.calls.length).toBeGreaterThan(before);
  });

  it("returns null toast when disabled", async () => {
    const result = await service([fakeProvider("openai")], { ...DEFAULT_CONFIG, enabled: false }).toast();
    expect(result.toast).toBeNull();
  });
});

describe("quota service diagnostics", () => {
  it("reports the selected model, live quota and v2 credential source without raw fields", async () => {
    const { report } = await service([fakeProvider("openai")]).info({
      currentProviderID: "openai", currentModel: "gpt-5",
    });
    expect(report).toContain("Current provider: openai");
    expect(report).toContain("Current model: gpt-5");
    expect(report).toContain("42% remaining");
    expect(report).toContain("OpenCode integration connections");
    expect(report).not.toContain("SECRET");
  });

  it("reports disabled mode without polling and excludes Anthropic", async () => {
    const openai = fakeProvider("openai");
    const anthropic = fakeProvider("anthropic");
    const anthropicAvailability = vi.spyOn(anthropic, "isAvailable");
    const { report } = await service([openai, anthropic], { ...DEFAULT_CONFIG, enabled: false }).info();
    expect(report).toContain("Plugin: disabled");
    expect(report).not.toContain("anthropic: enabled");
    expect(openai.fetch).not.toHaveBeenCalled();
    expect(anthropicAvailability).not.toHaveBeenCalled();
    expect(anthropic.fetch).not.toHaveBeenCalled();
  });

  it("keeps other providers visible when an availability check fails", async () => {
    const broken = fakeProvider("broken");
    broken.isAvailable = async () => { throw new Error("private detail"); };
    const { report } = await service([broken, fakeProvider("openai")]).info();
    expect(report).toContain("Availability check failed");
    expect(report).toContain("42% remaining");
    expect(report).not.toContain("private detail");
    expect(broken.fetch).not.toHaveBeenCalled();
  });
});
