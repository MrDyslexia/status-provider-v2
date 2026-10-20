import type { SessionTokensData } from "../lib/entries.js";

export interface UsageMessage {
  readonly type: string;
  readonly model?: { readonly id: string; readonly providerID: string };
  readonly tokens?: {
    readonly input: number;
    readonly output: number;
    readonly reasoning?: number;
    readonly cache: { readonly read: number; readonly write: number };
  };
}

/** Input excludes cached reads in OpenCode v2; cache writes are billed input. */
export function summarizeSessionUsage(messages: readonly UsageMessage[], totals?: UsageMessage["tokens"]): SessionTokensData | null {
  const models = new Map<string, SessionTokensData["models"][number]>();
  const count = (v: number) => Number.isFinite(v) && v > 0 ? v : 0;
  for (const message of messages) {
    if (message.type !== "assistant" || !message.model || !message.tokens) continue;
    const { tokens } = message;
    const key = `${message.model.providerID}/${message.model.id}`;
    const model = models.get(key) ?? { modelID: key, input: 0, cachedInput: 0, totalInput: 0, output: 0 };
    model.input += count(tokens.input) + count(tokens.cache.write);
    model.cachedInput = (model.cachedInput ?? 0) + count(tokens.cache.read);
    model.totalInput = model.input + model.cachedInput;
    model.output += count(tokens.output);
    models.set(key, model);
  }
  if (totals) {
    const input = count(totals.input) + count(totals.cache.write);
    const cachedInput = count(totals.cache.read);
    const output = count(totals.output);
    const contextInput = [...models.values()].reduce((n, m) => n + m.input, 0);
    const contextOutput = [...models.values()].reduce((n, m) => n + m.output, 0);
    const contextCached = [...models.values()].reduce((n, m) => n + (m.cachedInput ?? 0), 0);
    // Compaction/revert can remove history from context(). Host session totals remain authoritative.
    if (input !== contextInput || output !== contextOutput || cachedInput !== contextCached) {
      return { models: [{ modelID: "Session (all models)", input, cachedInput, totalInput: input + cachedInput, output }], totalInput: input, totalCachedInput: cachedInput, totalCombinedInput: input + cachedInput, totalOutput: output };
    }
  }
  if (!models.size) return null;
  const rows = [...models.values()];
  return {
    models: rows,
    totalInput: rows.reduce((n, m) => n + m.input, 0),
    totalCachedInput: rows.reduce((n, m) => n + (m.cachedInput ?? 0), 0),
    totalCombinedInput: rows.reduce((n, m) => n + (m.totalInput ?? 0), 0),
    totalOutput: rows.reduce((n, m) => n + m.output, 0),
  };
}
