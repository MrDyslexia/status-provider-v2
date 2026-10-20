import { beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ qwen: vi.fn(), alibaba: vi.fn() }));
vi.mock("../src/lib/qwen-local-status.js", () => ({ recordQwenCompletion: calls.qwen, recordAlibabaCodingPlanCompletion: calls.alibaba }));
import { recordLocalCompletion } from "../src/v2/local-usage.js";
beforeEach(() => vi.clearAllMocks());
describe("v2 local completion observer", () => {
  it("records configured Qwen and Alibaba usage through shared estimators", async () => {
    await recordLocalCompletion("qwen-code", { "qwen-code": { type: "oauth", access: "test" } } as never, true);
    await recordLocalCompletion("alibaba-coding-plan", { "alibaba-coding-plan": { type: "api", key: "test" } } as never, true);
    expect(calls.qwen).toHaveBeenCalledTimes(1); expect(calls.alibaba).toHaveBeenCalledTimes(1);
  });
  it("does not record disabled, unconfigured or unrelated providers", async () => {
    await recordLocalCompletion("qwen-code", {} as never, true);
    await recordLocalCompletion("openai", {} as never, true);
    await recordLocalCompletion("alibaba", { alibaba: { type: "api", key: "test" } } as never, false);
    expect(calls.qwen).not.toHaveBeenCalled(); expect(calls.alibaba).not.toHaveBeenCalled();
  });
});
