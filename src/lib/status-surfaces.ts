/**
 * Surface builders shared by the v1 TUI runtime and the v2 server plugin.
 *
 * Everything here works from a resolved `StatusRuntimeContext`; nothing depends
 * on a host plugin SDK, so it can run wherever credentials are available.
 */

import type { CompactStatusState, SidebarPanelState } from "./tui-panel-state.js";
import type { CollectStatusRenderDataResult } from "./status-render-data.js";
import type { StatusRuntimeContext } from "./status-runtime-context.js";
import type { StatusProviderEntry, StatusProviderError, SessionTokensData } from "./entries.js";
import type { PercentDisplayMode } from "./types.js";

import { createStatusRuntimeRequestContext } from "./status-runtime-context.js";
import { collectStatusRenderData } from "./status-render-data.js";
import { resolveStatusFormatStyle } from "./status-format-style.js";
import { buildCompactStatusStatusLine } from "./tui-compact-format.js";
import { buildSidebarStatusPanelLines } from "./tui-sidebar-format.js";
import { formatStatusRows } from "./format.js";
import { clampPercent, resolveDisplayedPercent } from "./format-utils.js";
import { sanitizeStatusRenderData } from "./display-sanitize.js";

const COMPACT_UNAVAILABLE_TEXT = "Status unavailable";

export type TuiSessionStatusSurfaces = {
  sidebar: SidebarPanelState;
  compact: CompactStatusState;
  /** Whether the session stopwatch should render (sidebar + compact line). */
  showSessionTimer: boolean;
};

export function isSessionSidebarEnabled(runtime: StatusRuntimeContext): boolean {
  return runtime.config.enabled && runtime.config.tuiSidebarPanel.enabled;
}

export function isSessionCompactEnabled(runtime: StatusRuntimeContext): boolean {
  return (
    runtime.config.enabled &&
    runtime.config.tuiCompactStatus.enabled &&
    runtime.config.tuiCompactStatus.sessionPrompt
  );
}

export function buildDisabledSessionStatusSurfaces(): TuiSessionStatusSurfaces {
  return {
    sidebar: { status: "disabled", lines: [] },
    compact: { status: "disabled" },
    showSessionTimer: false,
  };
}

export function buildCompactStatusFromData(params: {
  runtime: StatusRuntimeContext;
  result: CollectStatusRenderDataResult;
  enabled: boolean;
  maxWidth?: number;
}): CompactStatusState {
  if (!params.enabled) return { status: "disabled" };

  if (params.result.selection?.waitingForCurrentSelection) {
    return { status: "loading" };
  }

  const text = params.result.data
    ? buildCompactStatusStatusLine({
        data: params.result.data,
        percentDisplayMode: params.runtime.config.percentDisplayMode,
        maxWidth: params.maxWidth ?? params.runtime.config.tuiCompactStatus.maxWidth,
      })
    : "";

  return {
    status: "ready",
    text: text.trim() ? text : COMPACT_UNAVAILABLE_TEXT,
  };
}

export function buildSidebarPanelFromData(params: {
  runtime: StatusRuntimeContext;
  result: CollectStatusRenderDataResult;
  formatStyle: ReturnType<typeof resolveStatusFormatStyle>;
}): SidebarPanelState {
  if (params.result.selection?.waitingForCurrentSelection) {
    return {
      status: "loading",
      lines: [],
    };
  }

  return {
    status: "ready",
    lines: params.result.data
      ? buildSidebarStatusPanelLines({
          data: params.result.data,
          config: { ...params.runtime.config, formatStyle: params.formatStyle },
        })
      : [],
  };
}

export async function collectTuiStatusRenderData(params: {
  runtime: StatusRuntimeContext;
  request: ReturnType<typeof createStatusRuntimeRequestContext>;
  surfaceExplicitProviderIssues?: boolean;
}): Promise<{
  result: CollectStatusRenderDataResult;
  formatStyle: ReturnType<typeof resolveStatusFormatStyle>;
}> {
  const formatStyle = resolveStatusFormatStyle(params.runtime.config.formatStyle);
  const result = await collectStatusRenderData({
    client: params.runtime.client,
    config: params.runtime.config,
    configMeta: params.runtime.configMeta,
    request: params.request,
    surfaceExplicitProviderIssues: params.surfaceExplicitProviderIssues ?? true,
    formatStyle,
    providers: params.runtime.providers,
  });

  return { result, formatStyle };
}

// The session compact surface (docked next to the prompt) is always narrower
// than the sidebar, so it always filters down to the provider backing the
// session's current model regardless of the global `onlyCurrentModel`
// setting, which only governs the sidebar/toast surfaces.
export function shouldIncludeSessionMetaForSurfaces(config: StatusRuntimeContext["config"]): boolean {
  return (
    config.onlyCurrentModel ||
    (config.tuiCompactStatus.enabled && config.tuiCompactStatus.sessionPrompt)
  );
}

export function buildCompactOnlyCurrentModelRuntime(runtime: StatusRuntimeContext): StatusRuntimeContext {
  if (runtime.config.onlyCurrentModel && !runtime.config.showSessionTokens) return runtime;
  return {
    ...runtime,
    config: {
      ...runtime.config,
      onlyCurrentModel: true,
      showSessionTokens: false,
    },
  };
}

/** Build the sidebar and compact surfaces for an already-resolved runtime. */
export async function buildSessionStatusSurfaces(
  runtime: StatusRuntimeContext,
): Promise<TuiSessionStatusSurfaces> {
  const sidebarEnabled = isSessionSidebarEnabled(runtime);
  const compactEnabled = isSessionCompactEnabled(runtime);

  if (!sidebarEnabled && !compactEnabled) {
    return buildDisabledSessionStatusSurfaces();
  }

  const compactRuntime = buildCompactOnlyCurrentModelRuntime(runtime);

  const sidebarPromise = sidebarEnabled
    ? collectTuiStatusRenderData({ runtime, request: createStatusRuntimeRequestContext(runtime) })
    : undefined;

  const compactPromise = !compactEnabled
    ? undefined
    : collectTuiStatusRenderData({
        runtime: compactRuntime,
        request: createStatusRuntimeRequestContext(compactRuntime),
        surfaceExplicitProviderIssues: false,
      });

  const [sidebarCollected, compactCollected] = await Promise.all([sidebarPromise, compactPromise]);

  return {
    sidebar:
      sidebarEnabled && sidebarCollected
        ? buildSidebarPanelFromData({
            runtime,
            result: sidebarCollected.result,
            formatStyle: sidebarCollected.formatStyle,
          })
        : { status: "disabled", lines: [] },
    compact:
      compactEnabled && compactCollected
        ? buildCompactStatusFromData({
            runtime,
            result: compactCollected.result,
            enabled: true,
          })
        : { status: "disabled" },
    showSessionTimer: runtime.config.showSessionTimer,
  };
}

export type TuiManualToast = {
  message: string;
  duration: number;
};

/** Build the `/status-provider` manual toast for an already-resolved runtime. */
export async function buildManualToast(runtime: StatusRuntimeContext, automatic = false): Promise<TuiManualToast | null> {
  if (!runtime.config.enabled) return null;

  const result = await collectStatusRenderData({
    client: runtime.client,
    config: runtime.config,
    configMeta: runtime.configMeta,
    request: createStatusRuntimeRequestContext(runtime),
    surfaceExplicitProviderIssues: true,
    formatStyle: resolveStatusFormatStyle(runtime.config.formatStyle),
    bypassProviderCache: true,
    providers: runtime.providers,
  });
  if (!result.data) return null;
  if (automatic && !runtime.config.showOnBothFail && result.data.entries.length === 0 && result.data.errors.length > 0) return null;

  const message = formatStatusRows({
    version: "1.0.0",
    layout: runtime.config.layout,
    entries: result.data.entries,
    errors: result.data.errors,
    style: resolveStatusFormatStyle(runtime.config.formatStyle),
    percentDisplayMode: runtime.config.percentDisplayMode,
    sessionTokens: result.data.sessionTokens,
    textVariant: runtime.config.toastTextVariant,
    providerNameVariant: runtime.config.toastProviderNameVariant,
    percentVariant: runtime.config.toastPercentVariant,
    colorVariant: runtime.config.toastColorVariant,
    alignmentVariant: runtime.config.toastAlignmentVariant,
  });

  return message.trim() ? { message, duration: runtime.config.toastDurationMs } : null;
}

// =============================================================================
// Structured snapshot (data, not pre-rendered text)
// =============================================================================
//
// The sidebar/compact text builders above apply the global textVariant /
// providerNameVariant / percentVariant / colorVariant / alignmentVariant
// settings, which only make sense for an ASCII-art text layout. The TUI now
// renders its own panels from structured data (OpenTUI components, not
// shipped strings), so those five settings no longer affect the TUI sidebar
// or compact line; they remain supported by the legacy text formatters.
//
// percentDisplayMode is different: it's a value-semantics choice (does 73%
// mean "73 left" or "73 used"), not a text-layout one, so it is still
// resolved here and carried as `displayPercent`/`displayUnit`.

export type StatusSnapshotEntry =
  | {
      kind: "percent";
      name: string;
      group?: string;
      label?: string;
      right?: string;
      resetTimeIso?: string;
      /** Raw remaining percent (0-100), independent of percentDisplayMode. Useful for color thresholds. */
      percentRemaining: number;
      /** Percent to render the bar/number as, already oriented per percentDisplayMode. */
      displayPercent: number;
      displayUnit: "left" | "used";
    }
  | {
      kind: "value";
      name: string;
      group?: string;
      label?: string;
      right?: string;
      resetTimeIso?: string;
      value: string;
    };

export interface StatusSnapshotError {
  label: string;
  message: string;
  retryable?: boolean;
}

export interface StatusPanelSnapshot {
  status: "disabled" | "loading" | "ready";
  entries: StatusSnapshotEntry[];
  errors: StatusSnapshotError[];
  tokenUsage?: { input: number; cachedInput: number; output: number };
}

export interface TuiSessionStatusSnapshot {
  sidebar: StatusPanelSnapshot;
  compact: StatusPanelSnapshot;
  showSessionTimer: boolean;
  /** tuiCompactStatus.maxWidth; the compact line's rendering width is config-owned. */
  compactMaxWidth: number;
}

// Optional RPC schema fields must be absent, not present-with-undefined: an
// `undefined` value survives object spreads/construction but fails the
// JSON-schema-backed RPC output validator (it only tolerates a missing key).
function optionalStrings<T extends Record<string, string | undefined>>(fields: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key in fields) {
    const value = fields[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function toSnapshotEntry(entry: StatusProviderEntry, percentDisplayMode: PercentDisplayMode): StatusSnapshotEntry {
  const base = { name: entry.name, ...optionalStrings({ group: entry.group, label: entry.label, right: entry.right, resetTimeIso: entry.resetTimeIso }) };
  if (entry.kind === "value") return { ...base, kind: "value", value: entry.value };
  const percentRemaining = clampPercent(entry.percentRemaining);
  return {
    ...base,
    kind: "percent",
    percentRemaining,
    displayPercent: resolveDisplayedPercent(percentRemaining, percentDisplayMode),
    displayUnit: percentDisplayMode === "used" ? "used" : "left",
  };
}

function toSnapshotError(error: StatusProviderError): StatusSnapshotError {
  return { label: error.label, message: error.message, ...(error.retryable !== undefined ? { retryable: error.retryable } : {}) };
}

export function toPanelSnapshot(params: {
  enabled: boolean;
  result?: CollectStatusRenderDataResult;
  percentDisplayMode: PercentDisplayMode;
  sessionTokens?: SessionTokensData | null;
}): StatusPanelSnapshot {
  if (!params.enabled) return { status: "disabled", entries: [], errors: [] };
  if (params.result?.selection?.waitingForCurrentSelection) return { status: "loading", entries: [], errors: [] };

  const data = params.result?.data ? sanitizeStatusRenderData(params.result.data) : null;
  const tokens = params.sessionTokens !== undefined ? params.sessionTokens : data?.sessionTokens;
  return {
    status: "ready",
    entries: (data?.entries ?? []).map((entry) => toSnapshotEntry(entry, params.percentDisplayMode)),
    errors: (data?.errors ?? []).map(toSnapshotError),
    ...(tokens ? { tokenUsage: {
      input: tokens.totalInput,
      cachedInput: tokens.totalCachedInput ?? 0,
      output: tokens.totalOutput,
    } } : {}),
  };
}

/** Build the sidebar and compact snapshots (structured data) for an already-resolved runtime. */
export async function buildSessionStatusSnapshot(runtime: StatusRuntimeContext): Promise<TuiSessionStatusSnapshot> {
  const sidebarEnabled = isSessionSidebarEnabled(runtime);
  const compactEnabled = isSessionCompactEnabled(runtime);

  if (!sidebarEnabled && !compactEnabled) {
    return {
      sidebar: { status: "disabled", entries: [], errors: [] },
      compact: { status: "disabled", entries: [], errors: [] },
      showSessionTimer: false,
      compactMaxWidth: runtime.config.tuiCompactStatus.maxWidth,
    };
  }

  const compactRuntime = buildCompactOnlyCurrentModelRuntime(runtime);

  const sidebarPromise = sidebarEnabled
    ? collectTuiStatusRenderData({ runtime, request: createStatusRuntimeRequestContext(runtime) })
    : undefined;

  const compactPromise = !compactEnabled
    ? undefined
    : collectTuiStatusRenderData({
        runtime: compactRuntime,
        request: createStatusRuntimeRequestContext(compactRuntime),
        surfaceExplicitProviderIssues: false,
      });

  const [sidebarCollected, compactCollected] = await Promise.all([sidebarPromise, compactPromise]);

  return {
    sidebar: toPanelSnapshot({
      enabled: sidebarEnabled,
      result: sidebarCollected?.result,
      percentDisplayMode: runtime.config.percentDisplayMode,
      sessionTokens: runtime.config.showSessionTokens ? runtime.sessionTokens : null,
    }),
    compact: toPanelSnapshot({
      enabled: compactEnabled,
      result: compactCollected?.result,
      percentDisplayMode: runtime.config.percentDisplayMode,
    }),
    showSessionTimer: runtime.config.showSessionTimer,
    compactMaxWidth: runtime.config.tuiCompactStatus.maxWidth,
  };
}
