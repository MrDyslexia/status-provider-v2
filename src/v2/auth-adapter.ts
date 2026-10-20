/**
 * OpenCode v2 credential adapter.
 *
 * Translates v2 integration connections into the v1-shaped `AuthData` that the
 * provider libraries already understand. This is read-only: it never refreshes,
 * activates or writes credentials (the host owns them).
 */

import type { AuthData } from "../lib/types.js";
import { expandIds } from "./provider-ids.js";

/** Structural subset of `Credential.Value` (keeps this module testable with fakes). */
export type CredentialValueLike =
  | {
      readonly type: "oauth";
      readonly access: string;
      readonly refresh: string;
      readonly expires: number;
      readonly metadata?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "key";
      readonly key: string;
      readonly metadata?: Readonly<Record<string, unknown>>;
      readonly configuration?: Readonly<Record<string, unknown>>;
    }
  | { readonly type: "external"; readonly metadata?: Readonly<Record<string, unknown>> }
  | { readonly type: string; readonly [key: string]: unknown };

export interface ConnectionSource<Connection> {
  list(): Promise<ReadonlyArray<{ readonly id: string }>>;
  active(integrationID: string): Promise<Connection | undefined>;
  resolve(connection: Connection): Promise<CredentialValueLike | undefined>;
}

/** Integrations that this adapter intentionally never exposes. */
export const EXCLUDED_INTEGRATIONS: ReadonlySet<string> = new Set();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Map one v2 credential value to a v1 auth entry, or null when it cannot be represented. */
export function toAuthEntry(value: CredentialValueLike | undefined): Record<string, unknown> | null {
  if (!value || !isRecord(value)) return null;

  if (value.type === "oauth") {
    if (typeof value.access !== "string" || typeof value.refresh !== "string") return null;
    const metadata = isRecord(value.metadata) ? value.metadata : {};
    return {
      ...metadata,
      type: "oauth",
      access: value.access,
      refresh: value.refresh,
      expires: typeof value.expires === "number" ? value.expires : 0,
    };
  }

  if (value.type === "key") {
    if (typeof value.key !== "string" || value.key.length === 0) return null;
    return { type: "api", key: value.key };
  }

  // "external" credentials keep their secrets outside OpenCode; nothing to expose.
  return null;
}

/**
 * Build a v1-shaped `AuthData` from all active connections.
 * One failing integration never prevents the others from resolving.
 */
export async function buildAuthData<Connection>(
  source: ConnectionSource<Connection>,
  options?: { readonly exclude?: ReadonlySet<string> },
): Promise<AuthData> {
  const exclude = options?.exclude ?? EXCLUDED_INTEGRATIONS;
  const integrations = await source.list();

  const resolved = await Promise.all(
    integrations.map(async ({ id }) => {
      if (exclude.has(id)) return null;
      try {
        const connection = await source.active(id);
        if (!connection) return null;
        const entry = toAuthEntry(await source.resolve(connection));
        return entry ? { id, entry } : null;
      } catch {
        // Skip this integration; the rest must still resolve.
        return null;
      }
    }),
  );

  // Assign in integration-list order so alias collisions resolve deterministically:
  // a real id always wins over an alias, and the first alias source wins otherwise.
  const auth: Record<string, unknown> = {};
  for (const item of resolved) {
    if (item) auth[item.id] = item.entry;
  }
  for (const item of resolved) {
    if (!item) continue;
    for (const alias of expandIds(item.id).slice(1)) {
      if (!(alias in auth)) auth[alias] = item.entry;
    }
  }

  return auth as AuthData;
}
