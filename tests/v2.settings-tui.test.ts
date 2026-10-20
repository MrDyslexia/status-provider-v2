import { describe, expect, it, vi } from "vitest";
import { configureStatusProvider } from "../src/v2/settings-tui.js";
import type { SettingField, SettingsSnapshot } from "../src/v2/settings-model.js";

async function wizard(field: SettingField, actions: (string | undefined)[], prompt?: string) {
  const snapshot: SettingsSnapshot = { path: "/sandbox/settings.json", revision: "revision", fields: [field] };
  const select = vi.fn(async () => actions.shift());
  const context = {
    data: { location: { default: () => ({ directory: "/sandbox" }) } },
    ui: { dialog: { select, prompt: vi.fn(async () => prompt), alert: vi.fn() }, toast: { show: vi.fn() } },
  };
  const rpc = { settingsRead: vi.fn(async () => snapshot), settingsSave: vi.fn(async () => ({ saved: true })) };
  const saved = vi.fn();
  await configureStatusProvider(context as never, rpc as never, new AbortController().signal, saved);
  return { context, rpc, saved, select };
}
const timer: SettingField = { key: "showSessionTimer", label: "Session stopwatch", group: "TUI", kind: "boolean", value: true, options: [], readOnly: false };
describe("native settings dialogs", () => {
  it("discards draft edits on Esc without issuing a save", async () => {
    const result = await wizard(timer, ["showSessionTimer", undefined]);
    expect(result.rpc.settingsSave).not.toHaveBeenCalled(); expect(result.saved).not.toHaveBeenCalled();
  });
  it("saves only explicit changed values and refreshes the UI", async () => {
    const result = await wizard(timer, ["showSessionTimer", "@save"]);
    expect(result.rpc.settingsSave).toHaveBeenCalledWith({ revision: "revision", changes: [{ key: "showSessionTimer", value: false }] }, expect.anything());
    expect(result.saved).toHaveBeenCalledTimes(1);
  });
  it("uses an enum selector for percentage semantics", async () => {
    const result = await wizard({ ...timer, key: "percentDisplayMode", label: "Percentage meaning", kind: "select", value: "remaining", options: ["remaining", "used"] }, ["percentDisplayMode", "used", "@save"]);
    expect(result.rpc.settingsSave).toHaveBeenCalledWith(expect.objectContaining({ changes: [{ key: "percentDisplayMode", value: "used" }] }), expect.anything());
  });
  it("rejects invalid numeric input locally", async () => {
    const result = await wizard({ ...timer, key: "requestTimeoutMs", kind: "number", value: 5000, minimum: 1, maximum: 300000 }, ["requestTimeoutMs", undefined], "NaN");
    expect(result.rpc.settingsSave).not.toHaveBeenCalled();
    expect(result.context.ui.toast.show).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });
  it("edits a manual provider list with native checkbox-like choices", async () => {
    const result = await wizard({ ...timer, key: "enabledProviders", kind: "providers", value: "auto", options: ["openai", "ollama-cloud"] }, ["enabledProviders", "manual", "openai", "@done", "@save"]);
    expect(result.rpc.settingsSave).toHaveBeenCalledWith(expect.objectContaining({ changes: [{ key: "enabledProviders", value: ["openai"] }] }), expect.anything());
  });
  it("drops changes when a value is toggled back to its initial value", async () => {
    const result = await wizard(timer, ["showSessionTimer", "showSessionTimer", undefined]);
    expect(result.rpc.settingsSave).not.toHaveBeenCalled();
  });
  it("explains a globally controlled setting without silently hiding or modifying it", async () => {
    const result = await wizard({ ...timer, readOnly: true }, ["showSessionTimer", undefined]);
    expect(result.context.ui.dialog.alert).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("global configuration") }));
    expect(result.rpc.settingsSave).not.toHaveBeenCalled();
  });
});
