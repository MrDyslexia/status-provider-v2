/**
 * Ollama Cloud status fetcher.
 *
 * Queries GET https://ollama.com/api/balance (10 req/min per user).
 * Supports current plans (USD balance) and legacy plans (session/weekly percent).
 */

import type { OllamaCloudResult } from "./types.js";
import { sanitizeDisplaySnippet, sanitizeDisplayText } from "./display-sanitize.js";
import { fetchWithTimeout } from "./http.js";
import { clampPercent } from "./format-utils.js";
import { resolveOllamaCloudApiKey } from "./ollama-cloud-config.js";

export {
  getOllamaCloudKeyDiagnostics,
  hasOllamaCloudApiKey as hasOllamaCloudApiKeyConfigured,
  type OllamaCloudKeySource,
} from "./ollama-cloud-config.js";

const OLLAMA_CLOUD_BALANCE_URL = "https://ollama.com/api/balance";

interface BalanceResponse {
  included?: {
    balance_usd?: number;
    allowance_usd?: number;
    period?: { from?: string; until?: string };
    session?: { remaining_percent?: number; resets_at?: string };
    weekly?: { remaining_percent?: number; resets_at?: string };
  };
  purchased?: { balance_usd?: number };
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function usd(v: number): string {
  return `$${v.toFixed(2)}`;
}

export async function queryOllamaCloudStatus(
  options: { requestTimeoutMs?: number } = {},
): Promise<OllamaCloudResult> {
  const resolved = await resolveOllamaCloudApiKey();
  if (!resolved) return null;

  try {
    const resp = await fetchWithTimeout(
      OLLAMA_CLOUD_BALANCE_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${resolved.key}`,
          "User-Agent": "OpenCode-Status-Toast/1.0",
        },
      },
      options.requestTimeoutMs,
    );

    if (!resp.ok) {
      const text = await resp.text();
      const retryAfter = Number(resp.headers.get("retry-after"));
      return {
        success: false,
        error: `Ollama Cloud API error ${resp.status}: ${sanitizeDisplaySnippet(text, 120)}`,
        ...(resp.status === 429 && Number.isFinite(retryAfter) ? { retryable: true } : {}),
        ...(resp.status === 429 ? { rateLimitedUntil: Date.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60) * 1000 } : {}),
      };
    }

    const data = (await resp.json()) as BalanceResponse;
    const included = data.included ?? {};
    const windows: Extract<OllamaCloudResult, { success: true }>["windows"] = [];

    if (isNum(included.session?.remaining_percent)) {
      windows.push({
        label: "Session",
        percentRemaining: clampPercent(included.session.remaining_percent),
        resetTimeIso: included.session.resets_at,
      });
    }
    if (isNum(included.weekly?.remaining_percent)) {
      windows.push({
        label: "Weekly",
        percentRemaining: clampPercent(included.weekly.remaining_percent),
        resetTimeIso: included.weekly.resets_at,
      });
    }
    if (isNum(included.balance_usd) && isNum(included.allowance_usd) && included.allowance_usd > 0) {
      windows.push({
        label: "Included",
        percentRemaining: clampPercent((included.balance_usd / included.allowance_usd) * 100),
        resetTimeIso: included.period?.until,
      });
    }

    const purchasedUsd = isNum(data.purchased?.balance_usd) ? data.purchased.balance_usd : undefined;

    return {
      success: true,
      windows,
      ...(purchasedUsd !== undefined && purchasedUsd > 0 ? { purchased: usd(purchasedUsd) } : {}),
    };
  } catch (err) {
    return {
      success: false,
      error: sanitizeDisplayText(err instanceof Error ? err.message : String(err)),
    };
  }
}
