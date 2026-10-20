import { describe, expect, it } from "vitest";

import { createV2StatusClient } from "../src/v2/client-shim.js";
import { isCanonicalProviderAvailable } from "../src/lib/provider-availability.js";

describe("createV2StatusClient", () => {
  it("lists active providers including v1 aliases", async () => {
    const client = createV2StatusClient({
      listProviders: async () => [
        { id: "openai", activation: "auto" },
        { id: "kimi-code-plan-global", activation: "enabled" },
      ],
    });
    const ids = (await client.config.providers()).data?.providers.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["openai", "kimi-code-plan-global", "kimi-code", "kimi-for-coding"]));
  });

  it("omits disabled providers", async () => {
    const client = createV2StatusClient({
      listProviders: async () => [
        { id: "openai", activation: "disabled" },
        { id: "zai-coding-plan", activation: "enabled" },
      ],
    });
    const ids = (await client.config.providers()).data?.providers.map((p) => p.id);
    expect(ids).toEqual(["zai-coding-plan"]);
  });

  it("returns empty config data when no source is given", async () => {
    const client = createV2StatusClient({ listProviders: async () => [] });
    expect((await client.config.get()).data).toEqual({});
  });

  it("works with the real availability check used by providers", async () => {
    const client = createV2StatusClient({
      listProviders: async () => [{ id: "openai", activation: "auto" }],
    });
    expect(
      await isCanonicalProviderAvailable({ ctx: { client }, providerId: "openai", fallbackOnError: false }),
    ).toBe(true);
  });
});
