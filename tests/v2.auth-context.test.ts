import { describe, expect, it } from "vitest";
import { withAuthSource, readAuthFileCached } from "../src/lib/opencode-auth.js";
import { getAuthCacheIdentity } from "../src/lib/auth-context.js";
import { waitForResult } from "../src/v2/tui-controller.js";

describe("v2 request isolation", () => {
  it("keeps parallel account credentials and cache identities isolated", async () => {
    const read = (key: string) => withAuthSource(async () => ({ openai: { type: "api", key } }) as never, key, async () => {
      await new Promise((r) => setTimeout(r, 2));
      return [getAuthCacheIdentity(), (await readAuthFileCached())?.openai];
    });
    expect(await Promise.all([read("account-a"), read("account-b")])).toEqual([
      ["account-a", { type: "api", key: "account-a" }], ["account-b", { type: "api", key: "account-b" }],
    ]);
  });
  it("cancels one subscriber without cancelling another waiting for the same poll", async () => {
    let finish!: (v: number) => void;
    const shared = new Promise<number>((r) => { finish = r; });
    const one = new AbortController(); const two = new AbortController();
    const a = waitForResult(shared, one.signal); const b = waitForResult(shared, two.signal);
    one.abort();
    await expect(a).rejects.toThrow();
    finish(42);
    await expect(b).resolves.toBe(42);
  });
});
