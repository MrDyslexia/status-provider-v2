import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeAnthropicProvider as provider } from "../src/v2/anthropic.js";
import { withAuthSource } from "../src/lib/opencode-auth.js";
const ctx = { config: { requestTimeoutMs: 1000 } } as never;
const call = (auth: any) => withAuthSource(async () => ({ anthropic: auth }), "test", () => provider.fetch(ctx));
afterEach(() => vi.unstubAllGlobals());
describe("v2 native Anthropic quota", () => {
  it("maps OAuth usage without invoking a CLI or refreshing credentials", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ five_hour: { utilization: 25 }, seven_day: { utilization: 60 } })));
    vi.stubGlobal("fetch", fetch);
    const result = await call({ type: "oauth", access: "test", refresh: "never-used", expires: Date.now() + 10000 });
    expect(result.entries.map((e) => "percentRemaining" in e && e.percentRemaining)).toEqual([75, 40]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/api/oauth/usage");
  });
  it("reports expired OAuth locally, with no rotation", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await call({ type: "oauth", access: "expired", expires: 1 })).errors[0]?.message).toContain("expired");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("distinguishes API-key inference from subscription quota", async () => {
    expect((await call({ type: "api", key: "test" })).errors[0]?.message).toContain("OAuth");
  });
  it("propagates rate-limit backoff without leaking provider response bodies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private body", { status: 429, headers: { "retry-after": "30" } })));
    const result = await call({ type: "oauth", access: "test" });
    expect(result.rateLimitedUntil).toBeGreaterThan(Date.now() + 29000);
    expect(JSON.stringify(result)).not.toContain("private body");
  });
});
