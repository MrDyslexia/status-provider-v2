import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@opencode/plugin/tui", () => ({ Plugin: { define: (p: unknown) => p } }));
vi.mock("solid-js", () => ({
  Show: () => null,
  createEffect: (fn: () => void) => fn(),
  createSignal: (v: unknown) => [() => v, (next: unknown) => { v = next; }],
}));
vi.mock("@opentui/solid/jsx-runtime", () => ({ jsx: () => null, jsxs: () => null, Fragment: "fragment" }));
import plugin from "../src/v2/tui.js";

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach((fn) => fn()); vi.useRealTimers(); });

async function mount(route: "session" | "home" = "session") {
  vi.useFakeTimers();
  const commands: any[] = [];
  const slots: string[] = [];
  const listeners = new Map<string, Function>();
  const removeSlot = vi.fn();
  const surfaces = vi.fn(async () => ({
    sidebar: {
      status: "ready",
      entries: [{ kind: "percent", name: "OpenAI", percentRemaining: 42, displayPercent: 42, displayUnit: "left" }],
      errors: [],
    },
    compact: {
      status: "ready",
      entries: [{ kind: "percent", name: "OpenAI", percentRemaining: 42, displayPercent: 42, displayUnit: "left" }],
      errors: [],
    },
    showSessionTimer: true,
    compactMaxWidth: 96,
  }));
  const toast = vi.fn(async () => ({ toast: { message: "quota", duration: 100 } }));
  const info = vi.fn(async () => ({ report: "diagnostics" }));
  const details = vi.fn(async () => ({
    generatedAt: 1000, selectedProviderID: "openai",
    providers: [{ id: "openai", label: "OpenAI", enabled: true, available: true }],
    panel: { status: "ready", entries: [], errors: [] },
  }));
  let activePanel: { name: string; sessionID: string } | undefined;
  const panel = {
    current: () => activePanel,
    open: vi.fn((name: string) => { if (route === "home") return false; activePanel = { name, sessionID: "s1" }; return true; }),
    close: vi.fn(() => { activePanel = undefined; }),
  };
  const show = vi.fn();
  const dialog = { set: vi.fn(), show: vi.fn(), clear: vi.fn() };
  const context = {
    client: { rpc: () => ({ surfaces, toast, info, details }) },
    storage: { memory: (_: string, options: any) => {
      const state = structuredClone(options.initial);
      return [state, (fn: Function) => fn(state)];
    } },
    data: {
      location: { default: () => ({ directory: "/test" }) },
      session: { get: () => ({ time: { created: 1 } }) },
      on: (type: string, fn: Function) => { listeners.set(type, fn); return () => listeners.delete(type); },
      listen: (fn: Function) => { listeners.set("*", fn); return () => listeners.delete("*"); },
    },
    ui: {
      model: { current: () => ({ modelID: "gpt-5", providerID: "openai" }) },
      router: { current: () => route === "session" ? ({ type: "session", sessionID: "s1" }) : ({ type: "home" }) },
      slot: (claim: any) => { slots.push(claim.append); return removeSlot; },
      toast: { show }, dialog, panel,
    },
    keymap: { layer: (fn: Function) => commands.push(...fn().commands) },
  };
  const dispose = await plugin.setup(context as never);
  cleanup.push(dispose as () => void);
  await Promise.resolve(); await Promise.resolve();
  return { commands, slots, listeners, surfaces, toast, info, details, panel, show, dialog, removeSlot, dispose: dispose as () => void };
}

describe("v2 TUI contract (replaces legacy hook/command smoke tests)", () => {
  it("registers native commands, the toast alias and three additive slots", async () => {
    const m = await mount();
    expect(m.commands.map((c) => c.slash.name)).toEqual(expect.arrayContaining(["status-provider", "status-provider-info"]));
    expect(m.commands.find((c) => c.id === "status-provider.show").slash.aliases).toContain("status-provider-toast");
    expect(m.slots).toEqual(["sidebar.content", "prompt.footer.status", "home.footer.status"]);
    expect(m.surfaces).toHaveBeenCalledWith(expect.objectContaining({ sessionID: "s1", surface: "session" }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it("shows manual quota through RPC without a prompt/chat API", async () => {
    const m = await mount();
    await m.commands.find((c) => c.id === "status-provider.show").run();
    expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ trigger: "manual", sessionID: "s1" }), expect.anything());
    expect(m.show).toHaveBeenCalledWith(expect.objectContaining({ message: "quota" }));
  });
  it("opens diagnostics locally using the report RPC", async () => {
    const m = await mount();
    await m.commands.find((c) => c.id === "status-provider.info").run();
    expect(m.info).toHaveBeenCalledTimes(1);
    expect(m.dialog.show).toHaveBeenCalledTimes(1);
  });
  it("honors automatic trigger responses and detaches listeners and slots", async () => {
    const m = await mount();
    m.listeners.get("session.execution.succeeded")!({ data: { sessionID: "s1" } });
    await Promise.resolve(); await Promise.resolve();
    expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ trigger: "idle" }), expect.anything());
    m.dispose();
    expect(m.listeners.size).toBe(0);
    expect(m.removeSlot).toHaveBeenCalledTimes(3);
  });
  it("does not show a late toast after plugin disposal", async () => {
    const m = await mount();
    let resolve!: (v: any) => void;
    m.toast.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const pending = m.commands.find((c) => c.id === "status-provider.show").run();
    m.dispose();
    resolve({ toast: { message: "late", duration: 1 } });
    await pending;
    expect(m.show).not.toHaveBeenCalled();
  });
});
