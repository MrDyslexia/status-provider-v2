import { describe, expect, it, vi } from "vitest";
import { createProviderMenuController } from "../src/v2/provider-menu-state.js";
import type { ProviderSelectionWire } from "../src/v2/rpc.js";

const auto: ProviderSelectionWire = {
  revision: "r1", readOnly: false, mode: "auto", selected: ["openai", "ollama-cloud"],
  providers: [
    { id: "openai", label: "OpenAI", available: true, enabled: true },
    { id: "ollama-cloud", label: "Ollama Cloud", available: true, enabled: true },
  ],
};
const manual: ProviderSelectionWire = { ...auto, revision: "r2", mode: "manual", selected: ["openai"] };
function setup(initial = auto) {
  const load = vi.fn(async () => structuredClone(initial));
  const save = vi.fn(async () => ({ saved: true }));
  const changed = vi.fn(), render = vi.fn();
  const controller = createProviderMenuController({ load, save, changed, render });
  return { controller, load, save, changed, render };
}
describe("provider menu controller", () => {
  it("opening only reads selection metadata", async () => {
    const { controller, load, save, changed } = setup();
    await controller.open();
    expect(load).toHaveBeenCalledTimes(1); expect(save).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
  });
  it("unchecking an auto-detected provider writes the existing global setting", async () => {
    const { controller, load, save, changed } = setup();
    await controller.open(); load.mockResolvedValue(manual);
    await controller.toggle("ollama-cloud");
    expect(save).toHaveBeenCalledWith({ revision: "r1", changes: [{ key: "enabledProviders", value: ["openai"] }] }, expect.any(AbortSignal));
    expect(changed).toHaveBeenCalledTimes(1); expect(controller.state.data?.selected).toEqual(["openai"]);
  });
  it("can switch manual mode back to auto without hardcoding all provider IDs", async () => {
    const { controller, load, save } = setup(manual);
    await controller.open(); load.mockResolvedValue(auto);
    await controller.toggle("@auto");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ changes: [{ key: "enabledProviders", value: "auto" }] }), expect.anything());
  });
  it("restores the previous checks on a conflicting save and requires reload", async () => {
    const { controller, save, changed } = setup();
    await controller.open(); save.mockRejectedValue({ message: "Configuration changed" });
    await controller.toggle("ollama-cloud");
    expect(controller.state.data?.selected).toEqual(auto.selected);
    expect(controller.state.error).toBe("Configuration changed");
    expect(changed).not.toHaveBeenCalled();
    await controller.toggle("openai"); expect(save).toHaveBeenCalledTimes(1);
  });
  it("does not edit read-only provider selections", async () => {
    const { controller, save } = setup({ ...auto, readOnly: true });
    await controller.open(); await controller.toggle("openai"); expect(save).not.toHaveBeenCalled();
  });
  it("ignores a late catalog after the menu closes", async () => {
    const { controller, load } = setup();
    let finish!: (value: ProviderSelectionWire) => void;
    load.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const opening = controller.open(); controller.close(); finish(auto); await opening;
    expect(controller.state.open).toBe(false); expect(controller.state.data).toBeNull();
  });
  it("keeps an explicit checkbox save when the user closes while saving", async () => {
    const { controller, save, changed, load } = setup();
    await controller.open(); let finish!: (value: { saved: boolean }) => void;
    save.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const saving = controller.toggle("ollama-cloud"); controller.close(); finish({ saved: true }); await saving;
    expect(controller.state.open).toBe(false); expect(changed).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledTimes(1);
  });
});
