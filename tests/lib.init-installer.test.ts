import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJsonOrJsonc } from "../src/lib/jsonc.js";
import { applyInitInstallerPlan, planInitInstaller, runInitInstaller, type InitInstallerSelections } from "../src/lib/init-installer.js";

// v2 installs one combined package, not a second plugin in tui.json.
describe("v2 installer", () => {
  let root: string;
  const selections: InitInstallerSelections = {
    scope: "project", statusUi: ["toast", "sidebar", "compact_status"],
    providerMode: "auto", manualProviders: [], formatStyle: "allWindows",
    percentDisplayMode: "remaining", showSessionTokens: true,
  };
  const read = (path: string) => parseJsonOrJsonc(readFileSync(path, "utf8"), path.endsWith("jsonc")) as any;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "status-provider-init-v2-")); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("plans without writing and installs server/TUI once at the worktree root", async () => {
    mkdirSync(join(root, ".git"));
    const nested = join(root, "packages", "app"); mkdirSync(nested, { recursive: true });
    const plan = await planInitInstaller({ selections, cwd: nested });
    expect(plan.baseDir).toBe(root);
    expect(plan.edits.map((e) => e.kind)).toEqual(["opencode", "status"]);
    expect(existsSync(join(root, "opencode.json"))).toBe(false);
    await applyInitInstallerPlan(plan);
    expect(read(join(root, "opencode.json"))).toMatchObject({ $schema: "https://opencode.ai/config.json", plugins: ["status-provider-v2"] });
    expect(existsSync(join(root, "tui.json"))).toBe(false);
    expect(read(join(root, "status-provider", "config.json"))).toMatchObject({ showSessionTokens: true, tuiSidebarPanel: { enabled: true }, tuiCompactStatus: { enabled: true, homeBottom: true, sessionPrompt: true } });
  });

  it("is idempotent and preserves plugin options and unrelated configuration", async () => {
    writeFileSync(join(root, "opencode.json"), JSON.stringify({ model: "openai/gpt-5", plugins: [["status-provider-v2", { sample: true }], "other"] }));
    const first = await planInitInstaller({ selections, cwd: root });
    await applyInitInstallerPlan(first);
    const second = await planInitInstaller({ selections, cwd: root });
    expect(second.edits.every((e) => !e.changed)).toBe(true);
    expect(read(join(root, "opencode.json"))).toMatchObject({ model: "openai/gpt-5", plugins: [["status-provider-v2", { sample: true }], "other"] });
  });

  it("uses global XDG roots without touching project configuration", async () => {
    const plan = await planInitInstaller({ selections: { ...selections, scope: "global" }, cwd: root, homeDir: root, env: { XDG_CONFIG_HOME: join(root, "xdg") } });
    await applyInitInstallerPlan(plan);
    expect(read(join(root, "xdg", "opencode", "opencode.json")).plugins).toEqual(["status-provider-v2"]);
    expect(existsSync(join(root, "opencode.json"))).toBe(false);
  });

  it("prefers existing JSONC and preserves its user settings", async () => {
    writeFileSync(join(root, "opencode.jsonc"), '{ // user setting\n "model": "openai/gpt-5", "plugins": ["other"],\n}');
    await applyInitInstallerPlan(await planInitInstaller({ selections, cwd: root }));
    expect(read(join(root, "opencode.jsonc"))).toMatchObject({ model: "openai/gpt-5", plugins: ["other", "status-provider-v2"] });
    expect(existsSync(join(root, "opencode.json"))).toBe(false);
  });

  it.each(["toast", "sidebar", "compact_status", "none"] as const)("keeps %s display intent in status-provider config", async (choice) => {
    await applyInitInstallerPlan(await planInitInstaller({ selections: { ...selections, statusUi: [choice] }, cwd: root }));
    const config = read(join(root, "status-provider", "config.json"));
    expect(config.enableToast).toBe(choice === "toast");
    expect(config.tuiSidebarPanel.enabled).toBe(choice === "sidebar");
    expect(config.tuiCompactStatus?.enabled ?? false).toBe(choice === "compact_status");
    expect(existsSync(join(root, "tui.json"))).toBe(false);
  });

  it("preserves explicitly configured display and provider choices", async () => {
    mkdirSync(join(root, "status-provider"));
    writeFileSync(join(root, "status-provider", "config.json"), JSON.stringify({ enabledProviders: ["ollama-cloud"], showSessionTokens: false, formatStyle: "singleWindow", percentDisplayMode: "used" }));
    await applyInitInstallerPlan(await planInitInstaller({ selections, cwd: root }));
    expect(read(join(root, "status-provider", "config.json"))).toMatchObject({ enabledProviders: ["ollama-cloud"], showSessionTokens: false, formatStyle: "singleWindow", percentDisplayMode: "used" });
  });

  it("normalizes provider aliases and keeps an explicit manual selection", async () => {
    await applyInitInstallerPlan(await planInitInstaller({ selections: { ...selections, providerMode: "manual", manualProviders: ["ollama-cloud", "openai"] }, cwd: root }));
    expect(read(join(root, "status-provider", "config.json")).enabledProviders).toEqual(["ollama-cloud", "openai"]);
  });

  it("rejects malformed plugins before writing either file", async () => {
    writeFileSync(join(root, "opencode.json"), '{"plugins": {"bad": true}}');
    await expect(planInitInstaller({ selections, cwd: root })).rejects.toThrow(/plugins is not an array/i);
    expect(existsSync(join(root, "status-provider", "config.json"))).toBe(false);
  });

  it("cancels the interactive installer without writing", async () => {
    const cancel = Symbol("cancel");
    const prompts = {
      intro: vi.fn(), outro: vi.fn(), select: vi.fn(async () => cancel),
      isCancel: (v: unknown) => v === cancel,
      multiselect: vi.fn(), confirm: vi.fn(),
      log: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
    };
    expect(await runInitInstaller({ cwd: root, prompts: prompts as never })).toBe(0);
    expect(existsSync(join(root, "opencode.json"))).toBe(false);
  });
});
