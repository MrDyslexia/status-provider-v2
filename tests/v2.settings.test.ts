import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createLoadConfigMeta, getStatusProviderConfigPath, loadConfig } from "../src/lib/config.js";
import { createSettingsService } from "../src/v2/settings-service.js";
import { createV2StatusClient } from "../src/v2/client-shim.js";
import type { StatusRuntimeContext } from "../src/lib/status-runtime-context.js";

let root: string; let path: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "status-settings-")); path = getStatusProviderConfigPath(root);
  vi.stubEnv("HOME", root); vi.stubEnv("OPENCODE_CONFIG_DIR", root); vi.stubEnv("XDG_CONFIG_HOME", root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
async function runtime(): Promise<StatusRuntimeContext> {
  const configMeta = createLoadConfigMeta();
  const config = await loadConfig(undefined, configMeta, { configRootDir: root });
  return { config, configMeta, roots: { workspaceRoot: root, configRoot: root }, providers: [], session: {}, client: createV2StatusClient({ listProviders: async () => [] }) as never };
}
const write = (value: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)); };

describe("server-owned TUI settings", () => {
  it("reading defaults does not create a file", async () => {
    const data = await createSettingsService(runtime).read();
    expect(data.fields.find((f) => f.key === "percentDisplayMode")?.value).toBe("remaining");
    expect(existsSync(path)).toBe(false);
  });
  it("saves flat and nested changes atomically and reloads the same canonical config", async () => {
    const service = createSettingsService(runtime); const initial = await service.read();
    await service.save({ revision: initial.revision, changes: [
      { key: "percentDisplayMode", value: "used" }, { key: "tuiCompactStatus.enabled", value: true },
      { key: "toastPercentVariant", value: "number" }, { key: "toastColorVariant", value: "auto" },
    ] });
    const next = await service.read();
    expect(next.revision).not.toBe(initial.revision);
    expect(next.fields.find((f) => f.key === "percentDisplayMode")?.value).toBe("used");
    expect(next.fields.find((f) => f.key === "tuiCompactStatus.enabled")?.value).toBe(true);
    expect(next.fields.find((f) => f.key === "toastPercentVariant")?.value).toBe("number");
    expect(next.fields.find((f) => f.key === "toastColorVariant")?.value).toBe("auto");
  });
  it("preserves unknown file fields without returning them to clients", async () => {
    write({ custom: { value: "PRESERVE" }, token: "DO_NOT_RETURN" });
    const service = createSettingsService(runtime); const data = await service.read();
    expect(JSON.stringify(data)).not.toContain("DO_NOT_RETURN");
    await service.save({ revision: data.revision, changes: [{ key: "showSessionTimer", value: false }] });
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ custom: { value: "PRESERVE" }, showSessionTimer: false });
  });
  it("rejects concurrent stale drafts instead of losing the first save", async () => {
    const service = createSettingsService(runtime); const data = await service.read();
    const results = await Promise.allSettled([
      service.save({ revision: data.revision, changes: [{ key: "showSessionTimer", value: false }] }),
      service.save({ revision: data.revision, changes: [{ key: "showSessionTokens", value: false }] }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it("detects edits made outside the wizard", async () => {
    const service = createSettingsService(runtime); const data = await service.read();
    write({ debug: true });
    await expect(service.save({ revision: data.revision, changes: [{ key: "showSessionTimer", value: false }] })).rejects.toThrow(/changed/);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ debug: true });
  });
  it.each([
    [{ key: "requestTimeoutMs", value: -1 }], [{ key: "showSessionTokens", value: "yes" }],
    [{ key: "percentDisplayMode", value: "invalid" }], [{ key: "enabledProviders", value: ["unknown"] }],
    [{ key: "tuiCompactStatus.maxWidth", value: 0 }], [{ key: "apiKey", value: "secret" }],
    [{ key: "__proto__.enabled", value: true }],
  ])("rejects invalid updates without writing (%j)", async (change) => {
    const service = createSettingsService(runtime); const data = await service.read();
    await expect(service.save({ revision: data.revision, changes: [change as never] })).rejects.toThrow();
    expect(existsSync(path)).toBe(false);
  });
  it("handles provider order, including clearing the explicit order", async () => {
    const service = createSettingsService(runtime); let data = await service.read();
    await service.save({ revision: data.revision, changes: [{ key: "providerOrder", value: ["ollama-cloud", "openai"] }] });
    data = await service.read();
    expect(data.fields.find((f) => f.key === "providerOrder")?.value).toEqual(["ollama-cloud", "openai"]);
    await service.save({ revision: data.revision, changes: [{ key: "providerOrder", value: [] }] });
    expect((await service.read()).fields.find((f) => f.key === "providerOrder")?.value).toEqual([]);
  });
  it("does not overwrite malformed configuration", async () => {
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, "{ broken");
    await expect(createSettingsService(runtime).read()).rejects.toThrow(/valid JSON/);
    expect(readFileSync(path, "utf8")).toBe("{ broken");
  });
  it("clears nullable provider overrides without disturbing other fields", async () => {
    write({ cursorIncludedApiUsd: 10, showSessionTimer: false });
    const service = createSettingsService(runtime); const data = await service.read();
    await service.save({ revision: data.revision, changes: [{ key: "cursorIncludedApiUsd", value: null }] });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ showSessionTimer: false });
  });
  it("marks globally controlled network settings read-only at workspace scope", async () => {
    const service = createSettingsService(async () => {
      const value = await runtime(); value.configMeta.globalConfigPaths = ["/global/opencode.json"];
      value.configMeta.networkSettingSources.enabled = "/global/opencode.json"; return value;
    });
    const data = await service.read();
    expect(data.fields.find((f) => f.key === "enabled")?.readOnly).toBe(true);
    await expect(service.save({ revision: data.revision, changes: [{ key: "enabled", value: false }] })).rejects.toThrow(/global/);
  });
});
