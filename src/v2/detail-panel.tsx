/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, Show } from "solid-js";
import type { Plugin } from "@opencode/plugin/tui";
import type { PanelInput } from "@opencode/plugin/tui/context";
import type { RpcClient } from "@opencode/client";
import type { SurfaceRequest } from "./quota-service.js";
import { StatusProviderRpc, type DetailsWire, type ProviderOptionWire } from "./rpc.js";
import { displayError, quotaPresentation, type QuotaTone } from "./sidebar-presentation.js";
import { bar, formatResetCountdown } from "../lib/format-utils.js";
import type { ScrollBoxRenderable } from "@opentui/core";
import { scrollCommands } from "./tui-scroll.js";

export const DETAIL_PANEL_NAME = "status-provider.quotas";
interface DetailState {
  providers: ProviderOptionWire[];
  selected?: string;
  result: DetailsWire | null;
  loading: boolean;
  error: string;
}
const INITIAL: DetailState = { providers: [], result: null, loading: false, error: "" };

export function registerDetailPanel(context: Plugin.Context, rpc: RpcClient<typeof StatusProviderRpc>,
  request: (sessionID?: string) => SurfaceRequest, onRefresh: () => void) {
  const [state, setState] = createSignal<DetailState>({ ...INITIAL });
  const [selecting, setSelecting] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());
  const clock = setInterval(() => setNow(Date.now()), 1000);
  let sessionID: string | undefined;
  let sequence = 0;
  let pending: AbortController | undefined;
  let disposed = false;

  const cancel = () => {
    sequence++;
    pending?.abort();
    setState((value) => ({ ...value, loading: false }));
  };
  async function load(providerID = state().selected, refresh = false): Promise<void> {
    if (disposed || !sessionID || (refresh && state().loading)) return;
    const generation = ++sequence;
    pending?.abort();
    const controller = pending = new AbortController();
    setState((value) => ({ ...value, selected: providerID, loading: true, error: "",
      result: value.selected === providerID ? value.result : null }));
    try {
      const result = await rpc.details({ ...request(sessionID), ...(providerID ? { providerFilter: providerID } : {}), refresh },
        { location: context.location ?? context.data.location.default(), signal: controller.signal }) as DetailsWire;
      if (disposed || generation !== sequence) return;
      setState({ providers: result.providers, selected: result.selectedProviderID ?? undefined, result, loading: false, error: "" });
      if (refresh) onRefresh();
    } catch (error) {
      if (disposed || generation !== sequence) return;
      setState((value) => ({ ...value, loading: false, error: displayError(error) }));
    }
  }

  function syncPanel() {
    const panel = context.ui.panel.current();
    const next = panel?.name === DETAIL_PANEL_NAME ? panel.sessionID : undefined;
    if (next === sessionID) return;
    sessionID = next;
    cancel();
    if (next) { setState({ ...INITIAL }); void load(undefined); }
  }
  createEffect(syncPanel);

  const color = (tone: QuotaTone) => tone === "muted" ? context.theme.text.muted : context.theme.text.feedback[tone].base;
  function View(props: { panel: PanelInput }) {
    let scroll: ScrollBoxRenderable | undefined;
    let previousProvider: string | undefined;
    createEffect(() => {
      const provider = state().selected;
      if (provider !== previousProvider) { previousProvider = provider; scroll?.scrollTo(0); }
    });
    async function pick() {
      if (selecting() || !state().providers.length) return;
      const activeSession = sessionID;
      setSelecting(true);
      try {
        const id = await context.ui.dialog.select({
          title: "Provider quotas", placeholder: "Find a provider", current: state().selected,
          options: state().providers.map((provider) => ({
            title: provider.label, value: provider.id,
            description: `${provider.enabled ? "Enabled" : "Disabled"} · ${provider.available ? "Detected" : "Not connected"}`,
          })),
        });
        if (!disposed && activeSession === sessionID && id) await load(id);
      } finally { if (!disposed) { setSelecting(false); props.panel.focus(); } }
    }
    function cycle(step: number) {
      const providers = state().providers;
      if (!providers.length) return;
      const index = providers.findIndex((provider) => provider.id === state().selected);
      void load(providers[(index + step + providers.length) % providers.length]!.id);
    }
    context.keymap.layer(() => ({
      mode: "global", priority: 100,
      enabled: props.panel.focused && !selecting(),
      commands: [
        ...scrollCommands(() => scroll),
        { bind: "r", title: "Refresh quota", run: () => load(state().selected, true) },
        { bind: "p", title: "Choose provider", run: pick },
        { bind: "left", title: "Previous provider", run: () => cycle(-1) },
        { bind: "right", title: "Next provider", run: () => cycle(1) },
        { bind: "f", title: "Toggle fullscreen", run: props.panel.toggleFullscreen },
        { bind: "escape", title: "Close quota details", run: () => { cancel(); props.panel.close(); } },
      ],
    }));
    const selected = () => state().providers.find((provider) => provider.id === state().selected);
    const barWidth = () => Math.min(24, Math.max(6, Math.floor(props.panel.width / 3)));
    return (
      <box width="100%" height="100%" gap={1}>
        <text fg={context.theme.text.base}><b>Provider quotas</b></text>
        <text fg={context.theme.text.base} wrapMode="word">{selected()?.label ?? "Select a provider"}</text>
        <text fg={context.theme.text.muted} wrapMode="word">←/→ provider · p choose · r refresh · f fullscreen · Esc close</text>
        <Show when={state().loading}><text fg={context.theme.text.muted}>{state().result ? "Refreshing quota…" : "Loading quota…"}</text></Show>
        <Show when={state().error}>
          <text fg={color("warning")} wrapMode="word">{state().result ? "Refresh failed · last reading shown" : "Unable to load quota"}{`: ${state().error}`}</text>
        </Show>
        <scrollbox ref={(node) => { scroll = node; }} flexGrow={1} minHeight={0} focused={props.panel.focused}>
          <box gap={1} width="100%">
            <Show when={state().result?.panel.status === "disabled"}>
              <text fg={context.theme.text.muted} wrapMode="word">Disabled in status-provider configuration.</text>
            </Show>
            <Show when={state().result?.panel.status === "ready" && !state().loading && !state().result?.panel.entries.length && !state().result?.panel.errors.length}>
              <text fg={context.theme.text.muted}>No quota data available.</text>
            </Show>
            {(state().result?.panel.entries ?? []).map((entry) => (
              <box gap={0} width="100%">
                <text fg={context.theme.text.base} wrapMode="word"><b>{entry.group ? `${entry.group} · ${entry.label ?? entry.name}` : entry.name}</b></text>
                {entry.kind === "percent" ? (
                  <box gap={0}>
                    <text fg={color(quotaPresentation(entry.percentRemaining).tone)} wrapMode="word">{`${bar(entry.displayPercent, barWidth())}  ${entry.displayPercent}% ${entry.displayUnit}`}</text>
                    <text fg={color(quotaPresentation(entry.percentRemaining).tone)}>{quotaPresentation(entry.percentRemaining).label}</text>
                  </box>
                ) : <text fg={context.theme.text.base} wrapMode="word">{entry.value}</text>}
                <Show when={entry.right}><text fg={context.theme.text.muted} wrapMode="word">{entry.right}</text></Show>
                <Show when={entry.resetTimeIso}>
                  <text fg={context.theme.text.muted} wrapMode="word">{`Reset: ${entry.resetTimeIso}`}</text>
                  <text fg={context.theme.text.muted} wrapMode="word">{`Countdown: ${formatResetCountdown(entry.resetTimeIso, { nowMs: now() })}`}</text>
                </Show>
              </box>
            ))}
            {(state().result?.panel.errors ?? []).map((error) => (
              <box gap={0} width="100%">
                <text fg={color(error.retryable ? "warning" : "error")} wrapMode="word"><b>{error.label}</b></text>
                <text fg={context.theme.text.muted} wrapMode="word">{error.message}</text>
              </box>
            ))}
          </box>
        </scrollbox>
        <Show when={state().result}><text fg={context.theme.text.muted} wrapMode="word">{`Snapshot: ${new Date(state().result!.generatedAt).toLocaleTimeString()} · all windows`}</text></Show>
      </box>
    );
  }

  const remove = context.ui.slot({ append: "session.panel", render: (panel) => (
    <Show when={panel.name === DETAIL_PANEL_NAME}><View panel={panel} /></Show>
  ) });
  return {
    reload() { if (sessionID && !disposed) void load(); },
    open() {
      if (!context.ui.panel.open(DETAIL_PANEL_NAME)) {
        context.ui.toast.show({ message: "Open a session to view provider quotas.", variant: "info" });
        return;
      }
      syncPanel();
    },
    dispose() {
      disposed = true;
      cancel();
      clearInterval(clock);
      context.ui.panel.close();
      remove();
    },
  };
}
