/**
 * Mapping between OpenCode v2 integration/provider ids and the ids the v1-era
 * provider libraries look up. Verified against OpenCode 2.0.32 (2026-10-19).
 *
 * Aliases are listed in priority order: the first v2 id that resolves wins.
 */
export const V1_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "kimi-code-plan-global": ["kimi-code", "kimi-for-coding"],
  "kimi-code-plan-cn": ["kimi-code", "kimi-for-coding"],
  "zhipuai-coding-plan": ["zhipu-coding-plan"],
};

/** All ids a v2 id should be visible as: itself first, then its v1 aliases. */
export function expandIds(v2Id: string): string[] {
  return [v2Id, ...(V1_ALIASES[v2Id] ?? [])];
}
