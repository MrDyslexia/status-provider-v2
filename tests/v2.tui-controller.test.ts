import { afterEach, describe, expect, it, vi } from "vitest";

import { createDebounced, createRefresher } from "../src/v2/tui-controller.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe("createRefresher", () => {
  it("applies loaded values", async () => {
    const apply = vi.fn();
    const r = createRefresher({ load: async () => 1, apply, fail: vi.fn() });
    await r.refresh();
    expect(apply).toHaveBeenCalledWith(1);
  });

  it("reports failures without applying", async () => {
    const apply = vi.fn();
    const fail = vi.fn();
    const r = createRefresher({
      load: async () => {
        throw new Error("down");
      },
      apply,
      fail,
    });
    await r.refresh();
    expect(apply).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledTimes(1);
  });

  it("never runs two loads at once and coalesces overlapping calls into one follow-up", async () => {
    const gates = [deferred<number>(), deferred<number>()];
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    const apply = vi.fn();
    const r = createRefresher({
      load: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        const v = await gates[calls++]!.promise;
        active--;
        return v;
      },
      apply,
      fail: vi.fn(),
    });

    const first = r.refresh();
    r.refresh();
    r.refresh();
    r.refresh();
    gates[0]!.resolve(1);
    await Promise.resolve();
    await Promise.resolve();
    gates[1]!.resolve(2);
    await first;

    expect(calls).toBe(2);
    expect(maxActive).toBe(1);
    expect(apply.mock.calls.map((c) => c[0])).toEqual([2]);
  });

  it("drops a late response after dispose", async () => {
    const gate = deferred<number>();
    const apply = vi.fn();
    const r = createRefresher({ load: () => gate.promise, apply, fail: vi.fn() });
    const pending = r.refresh();
    r.dispose();
    gate.resolve(1);
    await pending;
    expect(apply).not.toHaveBeenCalled();
  });

  it("is inert after dispose", async () => {
    const load = vi.fn(async () => 1);
    const r = createRefresher({ load, apply: vi.fn(), fail: vi.fn() });
    r.dispose();
    await r.refresh();
    expect(load).not.toHaveBeenCalled();
  });
});

describe("createDebounced", () => {
  it("fires once after the delay and can be cancelled", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createDebounced(fn, 100);
    d.trigger();
    d.trigger();
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);

    d.trigger();
    d.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
