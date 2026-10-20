import { describe, expect, it, vi } from "vitest";
import { scrollCommands } from "../src/v2/tui-scroll.js";

describe("explicit keyboard scrolling", () => {
  it.each([["down", 1, undefined], ["up", -1, undefined], ["pagedown", 1, "viewport"], ["pageup", -1, "viewport"]])("handles %s without relying on scrollbox default focus", (bind, delta, unit) => {
    const scroll = { scrollHeight: 100, scrollBy: vi.fn(), scrollTo: vi.fn() };
    scrollCommands(() => scroll).find((command) => command.bind === bind)!.run();
    if (unit) expect(scroll.scrollBy).toHaveBeenCalledWith(delta, unit);
    else expect(scroll.scrollBy).toHaveBeenCalledWith(delta);
  });
  it("supports Home and End and an unmounted scrollbox", () => {
    const scroll = { scrollHeight: 100, scrollBy: vi.fn(), scrollTo: vi.fn() };
    const commands = scrollCommands(() => scroll);
    commands.find((command) => command.bind === "home")!.run();
    commands.find((command) => command.bind === "end")!.run();
    expect(scroll.scrollTo.mock.calls).toEqual([[0], [100]]);
    expect(() => scrollCommands(() => undefined).forEach((command) => command.run())).not.toThrow();
  });
});
