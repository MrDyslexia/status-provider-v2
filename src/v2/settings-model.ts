export type SettingValue = boolean | number | string | string[] | null;
export type SettingKind = "boolean" | "number" | "select" | "multi" | "providers" | "order";
export interface SettingDefinition {
  key: string; label: string; group: string; kind: SettingKind;
  options?: readonly string[]; minimum?: number; maximum?: number; nullable?: boolean;
}
export interface SettingField extends SettingDefinition {
  value: SettingValue;
  readOnly: boolean;
  options: string[];
}
export interface SettingsSnapshot {
  path: string; revision: string; fields: SettingField[];
}
export interface SettingsUpdate { revision: string; changes: { key: string; value: SettingValue }[] }

const bool = (key: string, label: string, group: string): SettingDefinition => ({ key, label, group, kind: "boolean" });
const select = (key: string, label: string, group: string, options: string[]): SettingDefinition => ({ key, label, group, options, kind: "select" });
const number = (key: string, label: string, group: string, minimum: number, maximum: number, nullable = false): SettingDefinition => ({ key, label, group, minimum, maximum, nullable, kind: "number" });

/** Public settings only. Never add credential paths or credentials to this catalog. */
export const SETTINGS: readonly SettingDefinition[] = [
  bool("enabled", "Plugin enabled", "General"),
  { key: "enabledProviders", label: "Enabled providers", group: "General", kind: "providers" },
  { key: "providerOrder", label: "Provider order", group: "General", kind: "order" },
  select("formatStyle", "Quota windows", "General", ["singleWindow", "allWindows"]),
  select("percentDisplayMode", "Percentage meaning", "General", ["remaining", "used"]),
  bool("onlyCurrentModel", "Only current model", "General"),
  bool("tuiSidebarPanel.enabled", "Sidebar", "TUI"),
  bool("showSessionTokens", "Session tokens", "TUI"),
  bool("showSessionTimer", "Session stopwatch", "TUI"),
  bool("tuiCompactStatus.enabled", "Compact status", "TUI"),
  bool("tuiCompactStatus.homeBottom", "Compact on home", "TUI"),
  bool("tuiCompactStatus.sessionPrompt", "Compact in session", "TUI"),
  number("tuiCompactStatus.maxWidth", "Compact max width", "TUI", 16, 500),
  bool("enableToast", "Automatic toasts", "Toasts"),
  bool("showOnIdle", "Toast after completion", "Toasts"),
  bool("showOnQuestion", "Toast on question", "Toasts"),
  bool("showOnCompact", "Toast after compaction", "Toasts"),
  bool("showOnBothFail", "Toast when all providers fail", "Toasts"),
  number("toastDurationMs", "Toast duration (ms)", "Toasts", 1, 300000),
  select("toastTextVariant", "Toast text style", "Toasts", ["default", "minimal", "box", "emoji"]),
  select("toastProviderNameVariant", "Toast provider names", "Toasts", ["full", "short", "icon"]),
  select("toastPercentVariant", "Toast percentages", "Toasts", ["number", "bar", "both"]),
  select("toastColorVariant", "Toast colors", "Toasts", ["auto", "none"]),
  select("toastAlignmentVariant", "Toast alignment", "Toasts", ["left", "right"]),
  number("minIntervalMs", "Minimum provider interval (ms)", "Network", 1, 86400000),
  number("requestTimeoutMs", "Request timeout (ms)", "Network", 1, 300000),
  bool("debug", "Debug output", "Advanced"),
  select("alibabaCodingPlanTier", "Alibaba plan", "Providers", ["lite", "pro"]),
  select("cursorPlan", "Cursor plan", "Providers", ["none", "pro", "pro-plus", "ultra"]),
  number("cursorIncludedApiUsd", "Cursor included API USD", "Providers", 0.01, 1000000, true),
  number("cursorBillingCycleStartDay", "Cursor billing cycle day", "Providers", 1, 28, true),
  { key: "googleModels", label: "Google models", group: "Providers", kind: "multi", options: ["G3PRO", "G3FLASH", "CLAUDE", "G3IMAGE"] },
  { key: "opencodeGoWindows", label: "OpenCode Go windows", group: "Providers", kind: "multi", options: ["rolling", "weekly", "monthly"] },
  select("pricingSnapshot.source", "Pricing source", "Advanced", ["auto", "bundled", "runtime"]),
  number("pricingSnapshot.autoRefresh", "Pricing refresh days", "Advanced", 1, 365),
  number("layout.maxWidth", "Toast max width", "Toast layout", 16, 500),
  number("layout.narrowAt", "Toast narrow breakpoint", "Toast layout", 1, 500),
  number("layout.tinyAt", "Toast tiny breakpoint", "Toast layout", 1, 500),
];
