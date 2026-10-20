import { describe, expect, it } from "vitest";
import { buildCompactSummary, buildSidebarRows } from "../src/v2/snapshot-format.js";
import type { SnapshotEntryWire } from "../src/v2/rpc.js";

const claude5h: SnapshotEntryWire = {
  kind: "percent", name: "5h", group: "Claude", label: "5h:",
  percentRemaining: 70, displayPercent: 70, displayUnit: "left",
};
const claudeWeekly: SnapshotEntryWire = {
  kind: "percent", name: "Weekly", group: "Claude", label: "Weekly:",
  percentRemaining: 30, displayPercent: 30, displayUnit: "left", resetTimeIso: "2099-01-01T00:00:00.000Z",
};
const openaiCredits: SnapshotEntryWire = { kind: "value", name: "OpenCode Go", value: "$4.20" };

describe("buildSidebarRows", () => {
  it("emits one group header per group run, not per entry", () => {
    const rows = buildSidebarRows([claude5h, claudeWeekly, openaiCredits]);
    expect(rows.filter((r) => r.kind === "group")).toHaveLength(1);
    expect(rows[0]).toEqual({ kind: "group", text: "Claude" });
  });

  it("uses the window label inside a group and the entry name for ungrouped entries", () => {
    const rows = buildSidebarRows([claude5h, openaiCredits]);
    expect(rows.find((r) => r.kind === "entry" && r.label === "5h")).toBeTruthy();
    expect(rows.find((r) => r.kind === "entry" && r.label === "OpenCode Go")).toBeTruthy();
  });

  it("carries displayPercent through for the bar, and formats value entries without one", () => {
    const rows = buildSidebarRows([claude5h, openaiCredits]);
    const percentRow = rows.find((r) => r.kind === "entry" && r.label === "5h");
    const valueRow = rows.find((r) => r.kind === "entry" && r.label === "OpenCode Go");
    expect(percentRow).toMatchObject({ percent: 70, right: "70% left" });
    expect(valueRow).toMatchObject({ right: "$4.20" });
    expect(valueRow && "percent" in valueRow).toBe(false);
  });

  it("re-emits a group header when the same group name returns after a different one", () => {
    const other: SnapshotEntryWire = { ...claude5h, group: "OpenAI" };
    const rows = buildSidebarRows([claude5h, other, claudeWeekly]);
    expect(rows.filter((r) => r.kind === "group").map((r) => (r as { text: string }).text)).toEqual([
      "Claude", "OpenAI", "Claude",
    ]);
  });
});

describe("buildCompactSummary", () => {
  it("joins multiple windows of the same group and separates providers with a middle dot", () => {
    const text = buildCompactSummary([claude5h, claudeWeekly, openaiCredits], 200);
    expect(text).toContain("Claude 70%");
    expect(text).toContain("30%");
    expect(text).toContain("OpenCode Go $4.20");
    expect(text).toContain(" · ");
  });

  it("truncates to maxWidth with an ellipsis", () => {
    const text = buildCompactSummary([claude5h, claudeWeekly, openaiCredits], 10);
    expect(text.length).toBe(10);
    expect(text.endsWith("\u2026")).toBe(true);
  });

  it("returns an empty string for no entries", () => {
    expect(buildCompactSummary([], 50)).toBe("");
  });
});
