/**
 * Server-side quota service.
 *
 * Owns provider polling and credential access. `surfaces()` returns
 * structured per-entry data (not pre-rendered text), so the TUI draws its
 * own panels; `toast()`/`info()` stay text since a host toast and a
 * diagnostics report are inherently text. Only sanitized data leaves the
 * server either way: no credential can reach a client.
 */

import type { StatusProvider, SessionTokensData } from "../lib/entries.js";
import type { RuntimeContextRootHints } from "../lib/config-file-utils.js";
import type { StatusProviderConfig } from "../lib/types.js";
import type { StatusPanelSnapshot } from "../lib/status-surfaces.js";
import type { V2StatusClient } from "./client-shim.js";

import { resolveStatusRuntimeContext } from "../lib/status-runtime-context.js";
import { buildV2InfoReport } from "./info-report.js";
import { getAuthCacheIdentity } from "../lib/auth-context.js";
import { nativeAnthropicProvider } from "./anthropic.js";
import { buildProviderDetails } from "./detail-service.js";
import type { DetailsWire } from "./rpc.js";
import {
  buildManualToast,
  buildSessionStatusSnapshot,
  shouldIncludeSessionMetaForSurfaces,
  type TuiManualToast,
} from "../lib/status-surfaces.js";

export interface SurfaceRequest {
  providerFilter?: string;
  sessionID?: string;
  surface?: "home" | "session";
  trigger?: "manual" | "idle" | "question" | "compact";
  /** Model id of the active session, used by the current-model filters. */
  currentModel?: string;
  /** Provider id of the active session. */
  currentProviderID?: string;
}

export interface SurfacesResult {
  generatedAt: number;
  sidebar: StatusPanelSnapshot;
  compact: StatusPanelSnapshot;
  showSessionTimer: boolean;
  compactMaxWidth: number;
}

export interface DetailRequest extends SurfaceRequest { refresh?: boolean }

export interface ToastResult {
  generatedAt: number;
  toast: TuiManualToast | null;
}

export interface QuotaServiceDeps {
  sessionUsage?: (sessionID: string) => Promise<SessionTokensData | null>;
  client: V2StatusClient;
  roots: RuntimeContextRootHints;
  /** Test hook: skip config file loading. */
  config?: StatusProviderConfig;
  /** Test hook: replace the provider set. */
  providers?: StatusProvider[];
  now?: () => number;
}

export interface QuotaService {
  details(request?: DetailRequest): Promise<DetailsWire>;
  surfaces(request?: SurfaceRequest): Promise<SurfacesResult>;
  /** Manual `/status-provider` toast; bypasses the provider cache. */
  toast(request?: SurfaceRequest): Promise<ToastResult>;
  info(request?: SurfaceRequest): Promise<{ report: string }>;
  dispose(): void;
}

export function createQuotaService(deps: QuotaServiceDeps): QuotaService {
  const now = deps.now ?? Date.now;
  const inFlight = new Map<string, Promise<unknown>>();
  let disposed = false;

  async function resolveRuntime(request: SurfaceRequest, includeMeta: (config: StatusProviderConfig) => boolean, includeUsage = true) {
    const sessionMeta =
      request.currentModel || request.currentProviderID
        ? { modelID: request.currentModel, providerID: request.currentProviderID }
        : undefined;

    const runtime = await resolveStatusRuntimeContext({
      client: deps.client as never,
      roots: deps.roots,
      config: deps.config,
      providers: deps.providers,
      sessionMeta,
      sessionID: request.sessionID,
      includeSessionMeta: includeMeta,
    });
    if (request.providerFilter) {
      runtime.providers = runtime.providers.filter((provider) => provider.id === request.providerFilter);
      runtime.config = { ...runtime.config, enabledProviders: [request.providerFilter], onlyCurrentModel: false };
    }

    return {
      ...runtime,
      sessionTokens: includeUsage && request.sessionID && runtime.config.showSessionTokens && deps.sessionUsage
        ? await deps.sessionUsage(request.sessionID).catch(() => null) : null,
      providers: runtime.providers.map((provider) => provider.id === "anthropic" ? nativeAnthropicProvider : provider),
    };
  }

  /** Single owner: concurrent callers with the same key share one in-flight poll. */
  function coalesce<T>(kind: string, request: SurfaceRequest, run: () => Promise<T>): Promise<T> {
    if (disposed) return Promise.reject(new Error("quota service disposed"));

    const key = JSON.stringify([getAuthCacheIdentity(), kind, request.providerFilter, request.sessionID, request.surface, request.trigger, request.currentModel ?? "", request.currentProviderID ?? ""]);
    const existing = inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const promise = run().finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
  }

  return {
    details(request = {}) {
      return coalesce(request.refresh ? "details.refresh" : "details", request, async () => {
        const { providerFilter, refresh, ...base } = request;
        const runtime = await resolveRuntime(base, () => true, false);
        return buildProviderDetails(runtime, { providerID: providerFilter, refresh, now: now() });
      });
    },
    surfaces(request = {}) {
      return coalesce("surfaces", request, async () => {
        const runtime = await resolveRuntime(request, shouldIncludeSessionMetaForSurfaces);
        const surfaceRuntime = request.surface === "home" ? {
          ...runtime,
          config: { ...runtime.config, tuiCompactStatus: {
            ...runtime.config.tuiCompactStatus, sessionPrompt: runtime.config.tuiCompactStatus.homeBottom,
          } },
        } : runtime;
        const snapshot = await buildSessionStatusSnapshot(surfaceRuntime);
        return { generatedAt: now(), ...snapshot };
      });
    },
    toast(request = {}) {
      return coalesce("toast", request, async () => {
        const runtime = await resolveRuntime(request, (config) => config.onlyCurrentModel);
        const trigger = request.trigger ?? "manual";
        if (trigger !== "manual" && (!runtime.config.enableToast ||
            (trigger === "idle" && !runtime.config.showOnIdle) ||
            (trigger === "question" && !runtime.config.showOnQuestion) ||
            (trigger === "compact" && !runtime.config.showOnCompact))) {
          return { generatedAt: now(), toast: null };
        }
        return { generatedAt: now(), toast: await buildManualToast(runtime, trigger !== "manual") };
      });
    },
    info(request = {}) {
      return coalesce("info", request, async () => {
        const runtime = await resolveRuntime(request, () => true);
        return { report: await buildV2InfoReport(runtime) };
      });
    },
    dispose() {
      disposed = true;
      inFlight.clear();
    },
  };
}
