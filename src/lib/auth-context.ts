import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthData } from "./types.js";

export const scopedAuth = new AsyncLocalStorage<{
  source: () => Promise<AuthData | null>;
  identity: string;
  signal?: AbortSignal;
}>();
export function getAuthCacheIdentity(): string { return scopedAuth.getStore()?.identity ?? "legacy"; }
export function getAuthRequestSignal(): AbortSignal | undefined { return scopedAuth.getStore()?.signal; }
