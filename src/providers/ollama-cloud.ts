/**
 * Ollama Cloud provider wrapper.
 */

import type { StatusProvider, StatusProviderContext, StatusProviderResult, StatusProviderEntry } from "../lib/entries.js";
import type { OllamaCloudResult } from "../lib/types.js";
import { queryOllamaCloudStatus, hasOllamaCloudApiKeyConfigured } from "../lib/ollama-cloud.js";
import { isCanonicalProviderAvailable } from "../lib/provider-availability.js";
import { modelProviderIncludesAny } from "../lib/provider-model-matching.js";
import { attemptedResult, attemptedRateLimitedResult, groupedPercentWindowEntries, mapNullableProviderResult } from "./result-helpers.js";

export const ollamaCloudProvider: StatusProvider = {
  id: "ollama-cloud",

  async isAvailable(ctx: StatusProviderContext): Promise<boolean> {
    const providerAvailable = await isCanonicalProviderAvailable({
      ctx,
      providerId: "ollama-cloud",
      fallbackOnError: false,
    });
    if (providerAvailable) return true;

    return await hasOllamaCloudApiKeyConfigured();
  },

  matchesCurrentModel(model: string): boolean {
    return modelProviderIncludesAny(model, ["ollama-cloud", "ollama"]);
  },

  async fetch(ctx: StatusProviderContext): Promise<StatusProviderResult> {
    const result = await queryOllamaCloudStatus({ requestTimeoutMs: ctx.config?.requestTimeoutMs });
    if (result && !result.success && result.rateLimitedUntil) return attemptedRateLimitedResult({ label: "Ollama Cloud", message: result.error, rateLimitedUntil: result.rateLimitedUntil });

    return mapNullableProviderResult<Extract<OllamaCloudResult, { success: true }>>(result, {
      errorLabel: "Ollama Cloud",
      onSuccess: (result) => {
        const entries: StatusProviderEntry[] = groupedPercentWindowEntries({
          group: "Ollama Cloud",
          windows: result.windows.map((w) => ({
            window: { percentRemaining: w.percentRemaining, resetTimeIso: w.resetTimeIso },
            suffix: w.label,
            label: `${w.label}:`,
          })),
          fallbackWhenEmpty: false,
        });
        if (result.purchased) {
          entries.push({
            kind: "value",
            name: "Ollama Cloud Credits",
            group: "Ollama Cloud",
            label: "Credits:",
            value: result.purchased,
          });
        }
        if (entries.length === 0) {
          entries.push({ kind: "value", name: "Ollama Cloud", value: "active" });
        }
        return attemptedResult(entries);
      },
    });
  },
};
