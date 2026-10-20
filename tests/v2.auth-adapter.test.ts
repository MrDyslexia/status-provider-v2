import { afterEach, describe, expect, it } from "vitest";

import { buildAuthData, toAuthEntry, type CredentialValueLike } from "../src/v2/auth-adapter.js";
import { readAuthFile, readAuthFileCached, setAuthSource } from "../src/lib/opencode-auth.js";

afterEach(() => setAuthSource(null));

type Conn = { id: string };

function source(values: Record<string, CredentialValueLike | undefined | Error>) {
  return {
    list: async () => Object.keys(values).map((id) => ({ id })),
    active: async (id: string): Promise<Conn | undefined> => (values[id] === undefined ? undefined : { id }),
    resolve: async (c: Conn) => {
      const v = values[c.id];
      if (v instanceof Error) throw v;
      return v;
    },
  };
}

describe("toAuthEntry", () => {
  it("maps oauth credentials and merges metadata", () => {
    expect(
      toAuthEntry({
        type: "oauth",
        access: "a",
        refresh: "r",
        expires: 123,
        metadata: { accountId: "acc" },
      }),
    ).toEqual({ type: "oauth", access: "a", refresh: "r", expires: 123, accountId: "acc" });
  });

  it("does not let metadata override core oauth fields", () => {
    const entry = toAuthEntry({
      type: "oauth",
      access: "a",
      refresh: "r",
      expires: 1,
      metadata: { access: "evil", type: "api" },
    });
    expect(entry).toMatchObject({ type: "oauth", access: "a" });
  });

  it("maps key credentials to the v1 api shape", () => {
    expect(toAuthEntry({ type: "key", key: "k" })).toEqual({ type: "api", key: "k" });
  });

  it("returns null for external, empty or missing credentials", () => {
    expect(toAuthEntry({ type: "external" })).toBeNull();
    expect(toAuthEntry({ type: "key", key: "" })).toBeNull();
    expect(toAuthEntry(undefined)).toBeNull();
  });
});

describe("buildAuthData", () => {
  it("builds a v1-shaped record keyed by integration id", async () => {
    const auth = await buildAuthData(
      source({
        openai: { type: "oauth", access: "a", refresh: "r", expires: 9 },
        "zai-coding-plan": { type: "key", key: "zk" },
      }),
    );
    expect(auth).toEqual({
      openai: { type: "oauth", access: "a", refresh: "r", expires: 9 },
      "zai-coding-plan": { type: "api", key: "zk" },
    });
  });

  it("honors an explicit integration exclusion", async () => {
    const auth = await buildAuthData(
      source({ anthropic: { type: "oauth", access: "a", refresh: "r", expires: 1 } }),
      { exclude: new Set(["anthropic"]) },
    );
    expect(auth).toEqual({});
  });

  it("skips integrations without an active connection or that fail", async () => {
    const auth = await buildAuthData(
      source({
        none: undefined,
        broken: new Error("boom"),
        openai: { type: "oauth", access: "a", refresh: "r", expires: 1 },
      }),
    );
    expect(Object.keys(auth)).toEqual(["openai"]);
  });
});

describe("v1 id aliases", () => {
  it("exposes v2 ids under the keys the v1 libs read", async () => {
    const auth = (await buildAuthData(
      source({
        "kimi-code-plan-global": { type: "key", key: "kg" },
        "kimi-code-plan-cn": { type: "key", key: "kc" },
        "zhipuai-coding-plan": { type: "key", key: "zp" },
      }),
    )) as Record<string, any>;
    expect(auth["kimi-code"].key).toBe("kg");
    expect(auth["kimi-for-coding"].key).toBe("kg");
    expect(auth["zhipu-coding-plan"].key).toBe("zp");
    expect(auth["kimi-code-plan-cn"].key).toBe("kc");
  });

  it("a real v1-named integration is never overridden by an alias", async () => {
    const auth = (await buildAuthData(
      source({
        "kimi-code": { type: "key", key: "real" },
        "kimi-code-plan-global": { type: "key", key: "alias" },
      }),
    )) as Record<string, any>;
    expect(auth["kimi-code"].key).toBe("real");
  });
});

describe("setAuthSource", () => {
  it("replaces filesystem reads and is cleared with null", async () => {
    setAuthSource(async () => ({ openai: { type: "oauth", access: "x", refresh: "y", expires: 1 } }) as never);
    expect(await readAuthFile()).toMatchObject({ openai: { access: "x" } });
    expect(await readAuthFileCached({ maxAgeMs: 0 })).toMatchObject({ openai: { access: "x" } });
  });

  it("returns null instead of throwing when the source fails", async () => {
    setAuthSource(async () => {
      throw new Error("down");
    });
    expect(await readAuthFile()).toBeNull();
  });
});
