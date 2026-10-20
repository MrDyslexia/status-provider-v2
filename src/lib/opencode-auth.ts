/**
 * OpenCode auth.json reader
 *
 * Shared helper to read auth from ~/.local/share/opencode/auth.json
 * (or platform equivalent). Providers should prefer this to duplicating
 * file/path parsing.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { scopedAuth } from "./auth-context.js";

import { getOpencodeRuntimeDirCandidates, getOpencodeRuntimeDirs } from "./opencode-runtime-paths.js";

import type { AuthData } from "./types.js";

const DEFAULT_AUTH_CACHE_MAX_AGE_MS = 5_000;

type AuthCacheEntry = {
  timestamp: number;
  value: AuthData | null;
  inFlight?: Promise<AuthData | null>;
};

let authCache: AuthCacheEntry | null = null;

/**
 * Pluggable credential source.
 *
 * OpenCode v2 stores credentials in its own database and exposes them through
 * the plugin SDK instead of an `auth.json` file. The server plugin registers a
 * source here so every provider keeps reading a v1-shaped `AuthData` without
 * touching the filesystem. When a source is registered, files are never read.
 */
export type AuthSource = () => Promise<AuthData | null>;

let authSource: AuthSource | null = null;

export function withAuthSource<T>(source: AuthSource, identity: string, run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return scopedAuth.run({ source, identity, signal }, run);
}

export { getAuthCacheIdentity, getAuthRequestSignal } from "./auth-context.js";

export function setAuthSource(source: AuthSource | null): void {
  authSource = source;
  authCache = null;
}

/** Unregister `source` only if it is still the active one (safe with several plugin instances). */
export function clearAuthSource(source: AuthSource): void {
  if (authSource === source) setAuthSource(null);
}

/**
 * Get candidate auth.json paths in priority order.
 * Some OpenCode installations use Linux-style paths even on macOS,
 * so we check multiple locations.
 */
export function getAuthPaths(): string[] {
  // OpenCode stores auth at `${Global.Path.data}/auth.json`.
  // We generate candidates based on OpenCode runtime dir semantics (xdg-basedir)
  // plus platform fallbacks for alternate/legacy installs.
  const { dataDirs } = getOpencodeRuntimeDirCandidates();
  return dataDirs.map((d) => join(d, "auth.json"));
}

/** Returns OpenCode's primary auth.json path (for display/logging) */
export function getAuthPath(): string {
  return join(getOpencodeRuntimeDirs().dataDir, "auth.json");
}

export async function readAuthFile(): Promise<AuthData | null> {
  const scoped = scopedAuth.getStore();
  if (scoped) return scoped.source();
  if (authSource) {
    try {
      return await authSource();
    } catch {
      return null;
    }
  }

  const paths = getAuthPaths();

  for (const path of paths) {
    try {
      const content = await readFile(path, "utf-8");
      return JSON.parse(content) as AuthData;
    } catch {
      // Try next path
    }
  }

  return null;
}

/**
 * Cached auth reader for frequently triggered code paths (e.g. per-question hooks).
 * This avoids repeated filesystem reads while keeping auth updates visible quickly.
 */
export async function readAuthFileCached(params?: { maxAgeMs?: number }): Promise<AuthData | null> {
  if (scopedAuth.getStore()) return readAuthFile();
  const maxAgeMs = Math.max(0, params?.maxAgeMs ?? DEFAULT_AUTH_CACHE_MAX_AGE_MS);
  const now = Date.now();

  if (authCache && now - authCache.timestamp <= maxAgeMs) {
    return authCache.value;
  }

  if (authCache?.inFlight) {
    return authCache.inFlight;
  }

  const inFlight = (async () => {
    const value = await readAuthFile();
    authCache = { timestamp: Date.now(), value };
    return value;
  })();

  authCache = {
    timestamp: authCache?.timestamp ?? 0,
    value: authCache?.value ?? null,
    inFlight,
  };

  try {
    return await inFlight;
  } finally {
    if (authCache?.inFlight === inFlight) {
      authCache.inFlight = undefined;
    }
  }
}

/** Clear cached auth so callers can force a fresh reread after token rotation. */
export function invalidateAuthFileCache(): void {
  authCache = null;
}

/** Test helper to clear cached auth state between test cases. */
export function clearReadAuthFileCacheForTests(): void {
  authCache = null;
}
