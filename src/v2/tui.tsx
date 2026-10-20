/** @jsxImportSource @opentui/solid */
/**
 * status-provider TUI plugin for OpenCode v2.
 *
 * Renders pre-formatted surfaces served by the status-provider server plugin
 * over RPC. This process never reads credentials or calls providers.
 */

import { Plugin } from "@opencode/plugin/tui";
import { Show, createEffect, createSignal } from "solid-js";
import { formatSessionTimerText } from "../lib/session-timer.js";

import { createDebounced, createRefresher } from "./tui-controller.js";
import { StatusProviderRpc, type InfoWire, type SurfacesWire, type ToastWire } from "./rpc.js";

export const TUI_PLUGIN_ID = "status-provider.tui";

const REFRESH_INTERVAL_MS = 60_000;
const EVENT_DEBOUNCE_MS = 600;

type PanelStatus = "disabled" | "loading" | "ready";

type SurfacesState = {
  sidebar: { status: PanelStatus; lines: string[] };
  compact: { status: PanelStatus; text: string };
  showSessionTimer: boolean;
  error: string;
};

const INITIAL_STATE: SurfacesState = {
  sidebar: { status: "loading", lines: [] },
  compact: { status: "loading", text: "" },
  showSessionTimer: false,
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
    const request = (overrideSessionID?: string) => {
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
          draft.sidebar = { status: result.sidebar.status, lines: [...result.sidebar.lines] };
          draft.compact = { status: result.compact.status, text: result.compact.text ?? "" };
          draft.showSessionTimer = result.showSessionTimer;
          draft.error = "";
        }),
      fail: (error) =>
        mutate((draft) => {
          draft.error = error instanceof Error ? error.message : String(error);
        }),
    });

    const debounced = createDebounced(() => void refresher.refresh(), EVENT_DEBOUNCE_MS);

    createEffect(() => {
      request();
      mutate((draft) => { draft.sidebar = { status: "loading", lines: [] }; draft.compact = { status: "loading", text: "" }; });
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

    const removeSidebar = context.ui.slot({
      append: "sidebar.content",
      render: () => (
        <Show when={state.sidebar.status !== "disabled"}>
          <box gap={0}>
            <text fg={context.theme.text.base}>
              <b>Status</b>
            </text>
            <Show when={timer()}><text fg={context.theme.text.muted}>{`Elapsed ${timer()}`}</text></Show>
            <Show when={state.error !== ""}>
              <text fg={context.theme.text.muted} wrapMode="none">
                {`unavailable: ${state.error}`}
              </text>
            </Show>
            {state.sidebar.lines.map((line) => (
              <text fg={context.theme.text.muted} wrapMode="none">
                {line || " "}
              </text>
            ))}
          </box>
        </Show>
      ),
    });

    const compact = () => (
      <Show when={state.compact.status === "ready" && state.compact.text !== ""}>
        <text fg={context.theme.text.muted} wrapMode="none">
          {state.compact.text}
          {timer() ? ` · ${timer()}` : ""}
        </text>
      </Show>
    );
    const removePrompt = context.ui.slot({ append: "prompt.footer.status", render: (input) => input.sessionID ? compact() : null });
    const removeHome = context.ui.slot({ append: "home.footer.status", render: compact });

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
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
