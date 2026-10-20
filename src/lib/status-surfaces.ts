/**
 * Surface builders shared by the v1 TUI runtime and the v2 server plugin.
 *
 * Everything here works from a resolved `StatusRuntimeContext`; nothing depends
 * on a host plugin SDK, so it can run wherever credentials are available.
 */

import type { CompactStatusState, SidebarPanelState } from "./tui-panel-state.js";
import type { CollectStatusRenderDataResult } from "./status-render-data.js";
import type { StatusRuntimeContext } from "./status-runtime-context.js";

import { createStatusRuntimeRequestContext } from "./status-runtime-context.js";
import { collectStatusRenderData } from "./status-render-data.js";
import { resolveStatusFormatStyle } from "./status-format-style.js";
import { buildCompactStatusStatusLine } from "./tui-compact-format.js";
import { buildSidebarStatusPanelLines } from "./tui-sidebar-format.js";
import { formatStatusRows } from "./format.js";

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
