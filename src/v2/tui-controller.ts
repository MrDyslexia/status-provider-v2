/**
 * Refresh controller for the TUI surfaces.
 *
 * Framework-free so it can be unit-tested. Guarantees:
 * - only the most recent request may update state (late responses are dropped);
 * - nothing is applied after `dispose()`;
 * - overlapping refresh calls never run more than one request at a time
 *   (a call arriving mid-flight schedules exactly one follow-up).
 */

export interface RefresherDeps<T> {
  load(signal: AbortSignal): Promise<T>;
  apply(value: T): void;
  fail(error: unknown): void;
}

export interface Refresher {
  refresh(): Promise<void>;
  dispose(): void;
}

export function createRefresher<T>(deps: RefresherDeps<T>): Refresher {
  let disposed = false;
  let running: Promise<void> | undefined;
  let again = false;
  let controller: AbortController | undefined;

  async function runOnce(): Promise<void> {
    try {
      controller = new AbortController();
      const value = await deps.load(controller.signal);
      if (!disposed && !again) deps.apply(value);
    } catch (error) {
      if (!disposed && !again) deps.fail(error);
    }
  }

  return {
    refresh() {
      if (disposed) return Promise.resolve();
      if (running) {
        again = true;
        return running;
      }

      running = (async () => {
        do {
          again = false;
          await runOnce();
        } while (again && !disposed);
      })().finally(() => {
        running = undefined;
      });

      return running;
    },
    dispose() {
      disposed = true;
      again = false;
      controller?.abort();
    },
  };
}

/** Trailing debounce that can be cancelled on dispose. */
export function createDebounced(fn: () => void, delayMs: number): { trigger(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    trigger() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        fn();
      }, delayMs);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** Cancel one subscriber without aborting a poll shared by other clients. */
export function waitForResult<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Request aborted"));
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new Error("Request aborted"));
    signal.addEventListener("abort", aborted, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}
