import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { writeJsonAtomic } from "./atomic-json.js";

export async function readConfigDocument(path: string) {
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { value: {} as Record<string, unknown>, revision: createHash("sha256").update("missing").digest("hex") };
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Configuration is not valid JSON; fix it before saving."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Configuration must be a JSON object.");
  return { value: value as Record<string, unknown>, revision: createHash("sha256").update(raw).digest("hex") };
}

const writes = new Map<string, Promise<unknown>>();
/** Shared CLI/TUI atomic persistence. A stale TUI draft never overwrites a newer save. */
export async function updateConfigDocument(path: string, expectedRevision: string | undefined,
  update: (value: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const previous = writes.get(path) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const current = await readConfigDocument(path);
    if (expectedRevision !== undefined && current.revision !== expectedRevision) {
      throw new Error("Configuration changed since it was opened. Reload settings before saving.");
    }
    await writeJsonAtomic(path, update(current.value), { trailingNewline: true });
  });
  writes.set(path, operation);
  try { await operation; } finally { if (writes.get(path) === operation) writes.delete(path); }
}
