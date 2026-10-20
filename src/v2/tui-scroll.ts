import type { KeymapCommand } from "@opencode/plugin/tui/context";

interface ScrollTarget {
  scrollHeight: number;
  scrollBy(delta: number, unit?: "absolute" | "viewport"): void;
  scrollTo(position: number): void;
}

/** The host keymap may consume navigation before a scrollbox handles it. */
export function scrollCommands(target: () => ScrollTarget | undefined): KeymapCommand[] {
  return [
    { bind: "down", title: "Scroll down", run: () => target()?.scrollBy(1) },
    { bind: "up", title: "Scroll up", run: () => target()?.scrollBy(-1) },
    { bind: "pagedown", title: "Next page", run: () => target()?.scrollBy(1, "viewport") },
    { bind: "pageup", title: "Previous page", run: () => target()?.scrollBy(-1, "viewport") },
    { bind: "home", title: "First row", run: () => target()?.scrollTo(0) },
    { bind: "end", title: "Last row", run: () => { const scroll = target(); scroll?.scrollTo(scroll.scrollHeight); } },
  ];
}
