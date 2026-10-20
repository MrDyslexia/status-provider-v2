import { describe, expect, it } from "vitest";
import { summarizeSessionUsage } from "../src/v2/session-usage.js";

describe("v2 session usage", () => {
  it("sums SDK assistant tokens by provider/model without double-counting cached reads", () => {
    const data = summarizeSessionUsage([
      { type: "assistant", model: { providerID: "openai", id: "gpt-5" }, tokens: { input: 100, output: 20, cache: { read: 50, write: 5 } } },
      { type: "assistant", model: { providerID: "openai", id: "gpt-5" }, tokens: { input: 10, output: 3, cache: { read: 2, write: 0 } } },
      { type: "user" },
    ]);
    expect(data).toMatchObject({ totalInput: 115, totalCachedInput: 52, totalCombinedInput: 167, totalOutput: 23 });
    expect(data?.models).toHaveLength(1);
  });
  it("does not infer zero usage when messages have no token measurements", () => {
    expect(summarizeSessionUsage([{ type: "assistant" }])).toBeNull();
  });
  it("preserves authoritative session totals after context compaction", () => {
    const data = summarizeSessionUsage([], { input: 1000, output: 90, cache: { read: 500, write: 10 } });
    expect(data).toMatchObject({ totalInput: 1010, totalCachedInput: 500, totalOutput: 90 });
    expect(data?.models[0]?.modelID).toBe("Session (all models)");
  });
});
