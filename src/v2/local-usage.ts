import type { AuthData } from "../lib/types.js";
import { recordQwenCompletion, recordAlibabaCodingPlanCompletion } from "../lib/qwen-local-status.js";

/** Optional integrations retain local estimates; no legacy auth plugin is installed automatically. */
export async function recordLocalCompletion(providerID: string, auth: AuthData, enabled: boolean): Promise<void> {
  if (!enabled) return;
  if (providerID === "qwen-code" && auth["qwen-code"]?.type === "oauth") await recordQwenCompletion();
  if (["alibaba", "alibaba-coding-plan"].includes(providerID) &&
      (auth["alibaba-coding-plan"] || auth.alibaba)) await recordAlibabaCodingPlanCompletion();
}
