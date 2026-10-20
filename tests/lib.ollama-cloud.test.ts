import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryOllamaCloudStatus } from "../src/lib/ollama-cloud.js";
import { ollamaCloudProvider } from "../src/providers/ollama-cloud.js";
import { setAuthSource } from "../src/lib/opencode-auth.js";

const ctx = { client: { config: { providers: async () => ({ data: { providers: [] } }), get: async () => ({ data: {} }) } }, config: {} } as never;

beforeEach(() => {
  delete process.env.OLLAMA_API_KEY;
  process.env.XDG_CONFIG_HOME = "/tmp/nonexistent-sp";
  setAuthSource(async () => ({ "ollama-cloud": { type: "api", key: "k" } }) as never);
});
afterEach(() => {
  setAuthSource(null);
  vi.unstubAllGlobals();
});

function stub(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const fn = vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("queryOllamaCloudStatus", () => {
  it("returns null without a key", async () => {
    setAuthSource(async () => ({}) as never);
    expect(await queryOllamaCloudStatus()).toBeNull();
  });

  it("maps USD balances and sends a bearer key", async () => {
    const fn = stub({
      included: { balance_usd: 72.5, allowance_usd: 100, period: { until: "2026-10-15T09:30:00Z" } },
      purchased: { balance_usd: 25 },
    });
    const out = await queryOllamaCloudStatus();
    expect(out).toMatchObject({ success: true, purchased: "$25.00" });
    expect(out && out.success && out.windows[0]).toMatchObject({ label: "Included", percentRemaining: 73 });
    expect((fn.mock.calls[0] as unknown[])[1]).toMatchObject({ headers: { Authorization: "Bearer k" } });
  });

  it("maps legacy session/weekly plans", async () => {
    stub({ included: { session: { remaining_percent: 75, resets_at: "x" }, weekly: { remaining_percent: 40 } } });
    const out = await queryOllamaCloudStatus();
    expect(out && out.success && out.windows.map((w) => w.label)).toEqual(["Session", "Weekly"]);
  });

  it("flags 429 with Retry-After as retryable", async () => {
    stub("slow", 429, { "retry-after": "30" });
    expect(await queryOllamaCloudStatus()).toMatchObject({ success: false, retryable: true });
  });

  it("reports auth errors", async () => {
    stub("bad", 401);
    const out = await queryOllamaCloudStatus();
    expect(out && !out.success && out.error).toContain("401");
  });
});

describe("ollamaCloudProvider", () => {
  it("is available via credentials and renders entries", async () => {
    expect(await ollamaCloudProvider.isAvailable(ctx)).toBe(true);
    stub({ included: { balance_usd: 50, allowance_usd: 100 }, purchased: { balance_usd: 5 } });
    const res = await ollamaCloudProvider.fetch(ctx);
    expect(res.attempted).toBe(true);
    expect(res.entries).toHaveLength(2);
  });

  it("matches ollama models", () => {
    expect(ollamaCloudProvider.matchesCurrentModel?.("ollama-cloud/gpt-oss")).toBe(true);
  });
});
