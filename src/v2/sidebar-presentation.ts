import type { PanelSnapshotWire, SnapshotErrorWire } from "./rpc.js";

export type QuotaTone = "success" | "warning" | "error" | "muted";

/** Always use remaining quota, including when the number/bar is shown as used. */
export function quotaPresentation(remaining: number): { tone: QuotaTone; label: string } {
  if (!Number.isFinite(remaining)) return { tone: "muted", label: "Unknown" };
  if (remaining <= 0) return { tone: "error", label: "Exhausted" };
  if (remaining <= 10) return { tone: "error", label: "Critical" };
  if (remaining <= 25) return { tone: "warning", label: "Low" };
  return { tone: "success", label: "Available" };
}

export function displayError(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message.trim() || "Status service unavailable";
  }
  return "Status service unavailable";
}

/** Keep API error bodies out of the narrow sidebar; diagnostics retains the full message. */
export function providerErrorSummary(error: SnapshotErrorWire): string {
  const status = error.message.match(/\b(?:HTTP|error)\s+(\d{3})\b/i)?.[1];
  if (status === "401") return "Authentication rejected (401)";
  if (status === "403") return "Access denied (403)";
  if (status === "429") return "Rate limited (429)";
  if (status?.startsWith("5")) return `Provider unavailable (${status})`;
  return error.message.trim() || "Quota unavailable";
}

/** A provider failure must never be rendered as a zero or an empty/loading panel. */
export function sidebarNotice(panel: PanelSnapshotWire, transportError: string): string {
  if (panel.status === "disabled") return "";
  if (transportError) return panel.entries.length ? "Update failed · last reading shown" : "Unable to load quota";
  if (panel.status === "loading") return "Loading quota…";
  if (!panel.entries.length && !panel.errors.length) return "No quota data available";
  return "";
}
