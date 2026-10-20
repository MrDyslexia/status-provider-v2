import { describe, expect, it } from "vitest";
import { displayError, providerErrorSummary, quotaPresentation, sidebarNotice } from "../src/v2/sidebar-presentation.js";
import { buildSidebarRows } from "../src/v2/snapshot-format.js";
import type { PanelSnapshotWire } from "../src/v2/rpc.js";

const panel: PanelSnapshotWire = { status: "ready", entries: [], errors: [] };

describe("quota severity", () => {
  it.each([
    [100, "success", "Available"], [26, "success", "Available"],
    [25, "warning", "Low"], [11, "warning", "Low"],
    [10, "error", "Critical"], [1, "error", "Critical"],
    [0, "error", "Exhausted"], [-1, "error", "Exhausted"],
    [NaN, "muted", "Unknown"],
  ])("labels %s remaining as %s / %s", (remaining, tone, label) => {
    expect(quotaPresentation(remaining as number)).toEqual({ tone, label });
  });
  it("uses remaining quota for severity even when the displayed bar means used", () => {
    const rows = buildSidebarRows([{ kind: "percent", name: "OpenAI", percentRemaining: 2, displayPercent: 98, displayUnit: "used" }]);
    expect(rows[0]).toMatchObject({ percent: 98, percentLabel: "98% used", quota: { tone: "error", label: "Critical" } });
  });
  it("renders reset countdowns with the client clock, without fetching again", () => {
    const now = Date.parse("2030-01-01T12:00:00Z");
    const entries = [{ kind: "value" as const, name: "Credits", value: "$5", resetTimeIso: "2030-01-01T13:00:00Z" }];
    expect(buildSidebarRows(entries, now)[0]).toMatchObject({ reset: "1h 0m" });
    expect(buildSidebarRows(entries, now + 60_000)[0]).toMatchObject({ reset: "59m" });
  });
});

describe("sidebar states", () => {
  it("distinguishes empty, loading and disabled panels", () => {
    expect(sidebarNotice(panel, "")).toBe("No quota data available");
    expect(sidebarNotice({ ...panel, status: "loading" }, "")).toBe("Loading quota…");
    expect(sidebarNotice({ ...panel, status: "disabled" }, "unavailable")).toBe("");
  });
  it("does not remain in Loading after a transport failure", () => {
    expect(sidebarNotice({ ...panel, status: "loading" }, "down")).toBe("Unable to load quota");
  });
  it("labels a retained reading explicitly when a refresh fails", () => {
    expect(sidebarNotice({ ...panel, entries: [{ kind: "value", name: "Credits", value: "$5" }] }, "down")).toContain("last reading shown");
  });
  it("does not represent a provider error as empty quota or exhaustion", () => {
    const errors = [{ label: "Ollama Cloud", message: 'Ollama Cloud API error 401: {"error":"invalid credentials"}' }];
    expect(sidebarNotice({ ...panel, errors }, "")).toBe("");
    expect(providerErrorSummary(errors[0]!)).toBe("Authentication rejected (401)");
  });
  it.each([[403, "Access denied (403)"], [429, "Rate limited (429)"], [503, "Provider unavailable (503)"]])("summarizes HTTP %s", (code, expected) => {
    expect(providerErrorSummary({ label: "Provider", message: `HTTP ${code}: long response body` })).toBe(expected);
  });
  it("extracts messages from RPC error objects instead of displaying [object Object]", () => {
    expect(displayError({ type: "rpc.invalid_output", message: "Expected string" })).toBe("Expected string");
    expect(displayError({})).toBe("Status service unavailable");
  });
});
