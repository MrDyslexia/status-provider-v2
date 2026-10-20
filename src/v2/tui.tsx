/** @jsxImportSource @opentui/solid */
/**
 * status-provider TUI plugin for OpenCode v2.
 *
 * Renders its own sidebar/compact panels from the structured snapshot served
 * by the status-provider server plugin over RPC. This process never reads
 * credentials or calls providers; it only draws numbers the server sent.
 */

import { Plugin } from "@opencode/plugin/tui";
import { Show, createEffect, createSignal } from "solid-js";
import { formatSessionTimerText } from "../lib/session-timer.js";
import { bar, formatTokenCount } from "../lib/format-utils.js";

import { createDebounced, createRefresher } from "./tui-controller.js";
import { buildCompactSummary, buildSidebarRows } from "./snapshot-format.js";
import { displayError, providerErrorSummary, sidebarNotice, type QuotaTone } from "./sidebar-presentation.js";
import { registerDetailPanel } from "./detail-panel.js";
import type { SurfaceRequest } from "./quota-service.js";
import {
  StatusProviderRpc,
  type InfoWire,
  type PanelSnapshotWire,
  type SurfacesWire,
  type ToastWire,
} from "./rpc.js";

export const TUI_PLUGIN_ID = "status-provider.tui";

const REFRESH_INTERVAL_MS = 60_000;
const EVENT_DEBOUNCE_MS = 600;
const SIDEBAR_BAR_WIDTH = 10;

const EMPTY_PANEL: PanelSnapshotWire = { status: "loading", entries: [], errors: [] };

type SurfacesState = {
  sidebar: PanelSnapshotWire;
  compact: PanelSnapshotWire;
  showSessionTimer: boolean;
  compactMaxWidth: number;
  error: string;
};

const INITIAL_STATE: SurfacesState = {
  sidebar: EMPTY_PANEL,
  compact: EMPTY_PANEL,
  showSessionTimer: false,
  compactMaxWidth: 96,
  error: "",
};

export default Plugin.define({
  id: TUI_PLUGIN_ID,
  setup(context) {
    const rpc = context.client.rpc(StatusProviderRpc);
    const [state, mutate] = context.storage.memory<SurfacesState>("status-provider.surfaces", {
      initial: INITIAL_STATE,
    });

    const location = () => context.location ?? context.data.location.default();
    const request = (overrideSessionID?: string): SurfaceRequest => {
      const route = context.ui.router.current();
      const sessionID = overrideSessionID ?? (route.type === "session" ? route.sessionID : undefined);
      const sessionModel = sessionID ? context.data.session.get(sessionID)?.model : undefined;
      const model = sessionModel ? { modelID: sessionModel.id, providerID: sessionModel.providerID } : context.ui.model.current();
      return {
        ...(model ? { currentModel: model.modelID, currentProviderID: model.providerID } : {}),
        ...(sessionID ? { sessionID, surface: "session" } : { surface: "home" }),
      };
    };
    let disposed = false;
    const lifetime = new AbortController();
    const [now, setNow] = createSignal(Date.now());
    const timerInterval = setInterval(() => setNow(Date.now()), 1000);
    const timer = () => {
      const route = context.ui.router.current();
      if (!state.showSessionTimer || route.type !== "session") return "";
      return formatSessionTimerText(context.data.session.get(route.sessionID)?.time.created, now());
    };
    const showToast = async (trigger = "manual", sessionID?: string) => {
      try {
        const result = await rpc.toast({ ...request(sessionID), trigger }, { location: location(), signal: lifetime.signal }) as ToastWire;
        if (disposed) return;
        if (result.toast) context.ui.toast.show({ ...result.toast, variant: "info", ...(sessionID ? { sessionID } : {}) });
        else if (trigger === "manual") context.ui.toast.show({ message: "Status Provider: no data available", variant: "warning" });
      } catch (error) {
        if (!disposed && trigger === "manual") context.ui.toast.show({ message: `Status Provider: ${String(error)}`, variant: "error" });
      }
    };

    const refresher = createRefresher({
      load: async (signal) => {
        return (await rpc.surfaces(
          request(),
          { location: location(), signal },
        )) as SurfacesWire;
      },
      apply: (result) =>
        mutate((draft) => {
          draft.sidebar = result.sidebar;
          draft.compact = result.compact;
          draft.showSessionTimer = result.showSessionTimer;
          draft.compactMaxWidth = result.compactMaxWidth;
          draft.error = "";
        }),
      fail: (error) =>
        mutate((draft) => {
          draft.error = displayError(error);
        }),
    });

    const debounced = createDebounced(() => void refresher.refresh(), EVENT_DEBOUNCE_MS);

    createEffect(() => {
      request();
      mutate((draft) => { draft.sidebar = EMPTY_PANEL; draft.compact = EMPTY_PANEL; draft.error = ""; });
      void refresher.refresh();
    });
    const interval = setInterval(() => void refresher.refresh(), REFRESH_INTERVAL_MS);

    // Events are refresh signals, not delivery guarantees; the interval reconciles.
    const stops = [
      context.data.on("session.execution.succeeded", (event) => {
        debounced.trigger();
        void showToast("idle", event.data.sessionID);
      }),
      context.data.listen(({ details }) => {
        if (details.type === "form.created") void showToast("question");
        if (details.type === "session.compaction.ended") { debounced.trigger(); void showToast("compact"); }
      }),
      context.data.on("credential.updated", () => debounced.trigger()),
      context.data.on("credential.switched", () => debounced.trigger()),
    ];

    const toneColor = (tone: QuotaTone) => tone === "muted" ? context.theme.text.muted : context.theme.text.feedback[tone].base;
    const rows = () => buildSidebarRows(state.sidebar.entries, now());
    const removeSidebar = context.ui.slot({
      append: "sidebar.content",
      render: () => (
        <Show when={state.sidebar.status !== "disabled"}>
          <box gap={1} width="100%">
            <text fg={context.theme.text.base}>
              <b>Status</b>
            </text>
            <Show when={timer()}><text fg={context.theme.text.muted}>{`Elapsed ${timer()}`}</text></Show>
            <Show when={sidebarNotice(state.sidebar, state.error)}>
              <text fg={state.error ? context.theme.text.feedback.warning.base : context.theme.text.muted} wrapMode="word">
                {sidebarNotice(state.sidebar, state.error)}
              </text>
            </Show>
            <Show when={state.error}>
              <text fg={context.theme.text.muted} wrapMode="word">{state.error}</text>
            </Show>
            {rows().map((row) =>
              row.kind === "group" ? (
                <text fg={context.theme.text.base} wrapMode="word">
                  <b>{row.text}</b>
                </text>
              ) : (
                <box gap={0} width="100%">
                  <text fg={context.theme.text.base} wrapMode="word">{row.label}</text>
                  <Show when={row.percent !== undefined}>
                    <box flexDirection="row" gap={1}>
                      <text flexShrink={0} fg={toneColor(row.quota?.tone ?? "muted")}>{bar(row.percent ?? 0, SIDEBAR_BAR_WIDTH)}</text>
                      <text fg={toneColor(row.quota?.tone ?? "muted")} wrapMode="word">{row.percentLabel}</text>
                    </box>
                    <text fg={toneColor(row.quota?.tone ?? "muted")}>{row.quota?.label}</text>
                  </Show>
                  <Show when={row.value}><text fg={context.theme.text.base} wrapMode="word">{row.value}</text></Show>
                  <Show when={row.details}><text fg={context.theme.text.muted} wrapMode="word">{row.details}</text></Show>
                  <Show when={row.reset}><text fg={context.theme.text.muted} wrapMode="word">{row.reset === "reset" ? "Reset due" : `Resets in ${row.reset}`}</text></Show>
                </box>
              ),
            )}
            {state.sidebar.errors.map((error) => (
              <box gap={0} width="100%">
                <text fg={toneColor(error.retryable ? "warning" : "error")} wrapMode="word"><b>{error.label}</b>{error.retryable ? " · Retrying" : " · Unavailable"}</text>
                <text fg={context.theme.text.muted} wrapMode="word">{providerErrorSummary(error)}</text>
              </box>
            ))}
            <Show when={state.sidebar.tokenUsage}>
              <box gap={0}>
                <text fg={context.theme.text.base}>Session tokens</text>
                <text fg={context.theme.text.muted} wrapMode="word">{state.sidebar.tokenUsage ? `In ${formatTokenCount(state.sidebar.tokenUsage.input)} · Cache ${formatTokenCount(state.sidebar.tokenUsage.cachedInput)} · Out ${formatTokenCount(state.sidebar.tokenUsage.output)}` : ""}</text>
              </box>
            </Show>
          </box>
        </Show>
      ),
    });

    const compact = () => {
      const text = buildCompactSummary(state.compact.entries, state.compactMaxWidth, now());
      return (
        <Show when={state.compact.status === "ready" && text !== ""}>
          <text fg={context.theme.text.muted} wrapMode="none">
            {text}
            {timer() ? ` · ${timer()}` : ""}
          </text>
        </Show>
      );
    };
    const removePrompt = context.ui.slot({ append: "prompt.footer.status", render: (input) => input.sessionID ? compact() : null });
    const removeHome = context.ui.slot({ append: "home.footer.status", render: compact });
    const detailPanel = registerDetailPanel(context, rpc, request, () => { void refresher.refresh(); });

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "status-provider.details", title: "Status Provider: provider quotas", group: "Status Provider", palette: true,
          slash: { name: "status-provider-details" }, run: () => detailPanel.open(),
        },
        {
          id: "status-provider.info",
          title: "Status Provider: diagnostics",
          group: "Status Provider",
          palette: true,
          slash: { name: "status-provider-info" },
          run: async () => {
            try {
              const result = (await rpc.info(
                request(),
                { location: location(), signal: lifetime.signal },
              )) as InfoWire;
              if (disposed) return;
              context.ui.dialog.set({ size: "large" });
              context.ui.dialog.show(() => {
                context.keymap.layer(() => ({
                  mode: "global",
                  priority: 100,
                  commands: [{ bind: "escape", run: () => context.ui.dialog.clear() }],
                }));
                return (
                  <box gap={1}>
                    <text fg={context.theme.text.base}><b>Status Provider diagnostics</b></text>
                    <scrollbox height={18} focused>
                      <text fg={context.theme.text.muted}>{result.report}</text>
                    </scrollbox>
                    <text fg={context.theme.text.muted}>Scroll to browse · Esc to close</text>
                  </box>
                );
              });
            } catch (error) {
              context.ui.toast.show({
                message: `Status Provider: ${error instanceof Error ? error.message : String(error)}`,
                variant: "error",
              });
            }
          },
        },
        {
          id: "status-provider.show",
          title: "Status Provider: show quota",
          group: "Status Provider",
          palette: true,
          slash: { name: "status-provider", aliases: ["status-provider-toast"] },
          run: () => showToast(),
        },
      ],
    }));

    return () => {
      if (disposed) return;
      disposed = true;
      lifetime.abort();
      detailPanel.dispose();
      clearInterval(timerInterval);
      refresher.dispose();
      debounced.cancel();
      clearInterval(interval);
      for (const stop of stops) stop();
      removeSidebar();
      removePrompt();
      removeHome();
    };
  },
});
