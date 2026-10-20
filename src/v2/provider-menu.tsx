/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup, Show } from "solid-js";
import type { Plugin } from "@opencode/plugin/tui";
import type { BoxRenderable, Renderable, ScrollBoxRenderable } from "@opentui/core";
import type { RpcClient } from "@opencode/client";
import { StatusProviderRpc, type ProviderSelectionWire } from "./rpc.js";
import { createProviderMenuController, type ProviderMenuState } from "./provider-menu-state.js";

/** Inline, anchored to Status. Checkboxes edit global enabledProviders, not visibility. */
export function createProviderMenu(context: Plugin.Context, rpc: RpcClient<typeof StatusProviderRpc>, changed: () => void) {
  const [state, setState] = createSignal<ProviderMenuState>({ open: false, loading: false, saving: false, error: "", data: null });
  const [cursor, setCursor] = createSignal(0);
  let header: BoxRenderable | undefined; let scroll: ScrollBoxRenderable | undefined;
  let previousFocus: Renderable | null = null;
  const controller = createProviderMenuController({
    load: async (signal) => await rpc.providerSelection({}, { location: context.location ?? context.data.location.default(), signal }) as ProviderSelectionWire,
    save: (update, signal) => rpc.settingsSave(update, { location: context.location ?? context.data.location.default(), signal }),
    changed, render: (next) => { setState(next); setCursor((current) => Math.min(current, next.data?.providers.length ?? 0)); },
  });
  function close(restore = true) {
    if (!controller.state.open) return;
    controller.close();
    if (restore && previousFocus && !previousFocus.isDestroyed) previousFocus.focus();
  }
  async function open() {
    if (!header || header.isDestroyed || header.height <= 0 || header.width <= 0) {
      context.ui.toast.show({ message: "Use /status-provider-config when the sidebar is hidden.", variant: "info" }); return;
    }
    if (state().open) { close(); return; }
    previousFocus = context.renderer.currentFocusedRenderable;
    setCursor(0);
    await controller.open();
  }
  const options = () => [
    { id: "@auto", label: "Auto-detect", checked: state().data?.mode === "auto", available: true },
    ...(state().data?.providers ?? []).map((provider) => ({ id: provider.id, label: provider.label,
      checked: state().data!.selected.includes(provider.id), available: provider.available,
    })),
  ];
  function move(delta: number) {
    const next = (cursor() + delta + options().length) % options().length;
    setCursor(next); scroll?.scrollChildIntoView(`status-provider-choice-${next}`);
  }
  context.keymap.layer(() => ({
    mode: "global", priority: 110, enabled: state().open, target: () => scroll,
    commands: [
      { bind: "up", run: () => move(-1) }, { bind: "down", run: () => move(1) },
      { bind: "space", run: () => controller.toggle(options()[cursor()]!.id) },
      { bind: "return", run: () => controller.toggle(options()[cursor()]!.id) },
      { bind: "escape", run: () => close() }, { bind: "tab", run: () => close() },
      { bind: "r", run: () => controller.reload() },
    ],
  }));
  function Header() {
    onCleanup(() => close(false));
    const [terminalHeight, setTerminalHeight] = createSignal(context.renderer.height);
    const resized = () => setTerminalHeight(context.renderer.height);
    context.renderer.on("resize", resized);
    onCleanup(() => context.renderer.off("resize", resized));
    const height = () => Math.max(3, Math.min(8, terminalHeight() - 13));
    return (
      <box gap={0} width="100%">
        <box ref={(node) => { header = node; }} onMouseDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation(); void open();
        }}>
          <text fg={context.theme.text.base} selectable={false}><b>{state().open ? "Status ▴" : "Status ▾"}</b></text>
        </box>
        <Show when={state().open}>
          <box gap={0} paddingLeft={1} width="100%">
            <text fg={context.theme.text.muted} wrapMode="word">Providers · global quota tracking</text>
            <scrollbox height={height()} focused ref={(node) => {
              scroll = node; node.on("blurred", () => close(false)); node.focus();
            }}>
              <box gap={0} width="100%">
                {options().map((option, index) => (
                  <text id={`status-provider-choice-${index}`} selectable={false} wrapMode="word"
                    fg={option.checked ? context.theme.text.base : context.theme.text.muted}
                    onMouseDown={(event) => {
                      if (event.button !== 0) return;
                      event.preventDefault(); event.stopPropagation();
                      setCursor(index); scroll?.focus(); void controller.toggle(option.id);
                    }}>
                    {`${cursor() === index ? ">" : " "} [${option.checked ? "x" : " "}] ${option.label}${!option.available ? " (not connected)" : ""}`}
                  </text>
                ))}
              </box>
            </scrollbox>
            <Show when={state().loading || state().saving}><text fg={context.theme.text.muted}>{state().saving ? "Saving…" : "Loading providers…"}</text></Show>
            <Show when={state().data?.readOnly}><text fg={context.theme.text.muted} wrapMode="word">Managed by global configuration</text></Show>
            <Show when={state().error}><text fg={context.theme.text.feedback.error.base} wrapMode="word">{state().error} · R to reload</text></Show>
            <text fg={context.theme.text.muted} wrapMode="word">Space/Enter toggle · Esc close</text>
          </box>
        </Show>
      </box>
    );
  }
  return { Header, open, expanded: () => state().open, reload: () => { if (state().open) void controller.reload(); },
    dispose() { close(); controller.dispose(); },
  };
}
