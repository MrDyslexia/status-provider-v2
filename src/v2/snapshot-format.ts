/**
 * Client-side presentation for structured status snapshots.
 *
 * Pure functions: given the entries the server already filtered/ordered/
 * resolved (percentDisplayMode, grouping), decide how to lay them out as
 * sidebar rows or a single compact line. No config, no credentials.
 */

import { formatResetCountdown } from "../lib/format-utils.js";
import type { SnapshotEntryWire } from "./rpc.js";
import { quotaPresentation } from "./sidebar-presentation.js";

export type SidebarRow =
  | { kind: "group"; text: string }
  | {
      kind: "entry"; label: string; right: string; percent?: number;
      percentLabel?: string; value?: string; details?: string; reset?: string;
      quota?: ReturnType<typeof quotaPresentation>;
    };

function entryLabel(entry: SnapshotEntryWire): string {
  if (!entry.group) return entry.name;
  return entry.label?.replace(/:+$/u, "").trim() || entry.name;
}

/** Build sidebar rows: one bold header per distinct `group` run, then its entries. */
export function buildSidebarRows(entries: SnapshotEntryWire[], nowMs = Date.now()): SidebarRow[] {
  const rows: SidebarRow[] = [];
  let lastGroup: string | undefined;

  for (const entry of entries) {
    if (entry.group !== lastGroup) {
      if (entry.group) rows.push({ kind: "group", text: entry.group });
      lastGroup = entry.group;
    }

    const resetLabel = formatResetCountdown(entry.resetTimeIso, { missing: "", nowMs });
    if (entry.kind === "value") {
      rows.push({
        kind: "entry",
        label: entryLabel(entry),
        right: [entry.value, resetLabel].filter(Boolean).join("  "),
        value: entry.value,
        details: entry.right,
        reset: resetLabel,
      });
      continue;
    }

    rows.push({
      kind: "entry",
      label: entryLabel(entry),
      right: [`${entry.displayPercent}% ${entry.displayUnit}`, entry.right, resetLabel].filter(Boolean).join("  "),
      percent: entry.displayPercent,
      percentLabel: `${entry.displayPercent}% ${entry.displayUnit}`,
      quota: quotaPresentation(entry.percentRemaining),
      details: entry.right,
      reset: resetLabel,
    });
  }

  return rows;
}

/** Build a single-line summary for the compact footer, truncated to `maxWidth`. */
export function buildCompactSummary(entries: SnapshotEntryWire[], maxWidth: number, nowMs = Date.now()): string {
  const grouped = new Map<string, string[]>();
  const order: string[] = [];
  const standalone: string[] = [];

  for (const entry of entries) {
    const resetLabel = formatResetCountdown(entry.resetTimeIso, { missing: "", nowMs });

    if (entry.kind === "value") {
      standalone.push([entry.name, entry.value, resetLabel].filter(Boolean).join(" "));
      continue;
    }

    const key = entry.group ?? entry.name;
    if (!grouped.has(key)) {
      grouped.set(key, []);
      order.push(key);
    }
    const windowLabel = entry.label?.replace(/:+$/u, "").trim();
    grouped.get(key)!.push([`${entry.displayPercent}%`, resetLabel, windowLabel].filter(Boolean).join(" "));
  }

  const segments = [...order.map((key) => `${key} ${grouped.get(key)!.join(" / ")}`), ...standalone];
  const text = segments.join(" · ");
  return text.length > maxWidth ? `${text.slice(0, Math.max(0, maxWidth - 1))}\u2026` : text;
}
