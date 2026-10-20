import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as {
  main?: string;
  bin?: Record<string, string>;
  exports?: Record<string, { default?: string; types?: string }>;
  "oc-plugin"?: string[];
  dependencies?: Record<string, string>;
  engines?: Record<string, string>;
  packageManager?: string;
};

const pnpmWorkspace = await readFile(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8");

describe("package manifest compatibility", () => {
  it("pins bun development tooling without raising runtime Node support", () => {
    // This fork uses bun-only (no npm/pnpm) per the maintainer's local
    // setup. Upstream pnpm-specific settings live in `pnpm-workspace.yaml`
    // and are not enforced here.
    expect(pkg.packageManager).toMatch(/^bun@/);
    expect(pkg.engines?.node).toBe(">=22.0.0");
  });

  it("hardens pnpm dependency resolution against fresh-package supply-chain attacks", () => {
    expect(pnpmWorkspace).toContain("minimumReleaseAge: 1440");
    expect(pnpmWorkspace).toContain("minimumReleaseAgeStrict: true");
    expect(pnpmWorkspace).toContain("minimumReleaseAgeIgnoreMissingTime: false");
    expect(pnpmWorkspace).toContain("blockExoticSubdeps: true");
    expect(pnpmWorkspace).toContain("allowBuilds:");
    expect(pnpmWorkspace).toContain("esbuild: true");
    expect(pnpmWorkspace).toContain("msgpackr-extract: true");
  });

  it("ships explicit server, tui, and init bin entrypoints for OpenCode", () => {
    expect(pkg.main).toBe("./dist/v2/server.js");
    expect(pkg.bin).toMatchObject({
      "status-provider": "./dist/bin/status-provider.js",
    });
    expect(pkg["oc-plugin"]).toEqual(["server", "tui"]);
    expect(pkg.dependencies?.["@clack/prompts"]).toBeTruthy();
    expect(pkg.exports?.["."]).toEqual({
      default: "./dist/v2/server.js",
      types: "./dist/v2/server.d.ts",
    });
    // The OpenCode v2 loader resolves these two subpaths as plain strings
    // (conditional objects are not picked up reliably), so keep them flat.
    expect(pkg.exports?.["./server"]).toBe("./dist/v2/server.js");
    expect(pkg.exports?.["./tui"]).toBe("./dist/v2/tui.js");
    expect(pkg.exports?.["./rpc"]).toEqual({
      default: "./dist/v2/rpc.js",
      types: "./dist/v2/rpc.d.ts",
    });
  });
});
