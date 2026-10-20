import { getStatusProviderConfigPath, normalizeStatusProviderUpdate } from "../lib/config.js";
import { readConfigDocument, updateConfigDocument } from "../lib/config-store.js";
import type { StatusRuntimeContext } from "../lib/status-runtime-context.js";
import { getProviders } from "../providers/registry.js";
import { SETTINGS, type SettingValue, type SettingsSnapshot, type SettingsUpdate } from "./settings-model.js";

export function settingAt(value: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined, value);
}
const networkKeys = new Set(["enabled", "enabledProviders", "minIntervalMs", "requestTimeoutMs", "pricingSnapshot.source", "pricingSnapshot.autoRefresh", "showOnIdle", "showOnQuestion", "showOnCompact", "showOnBothFail"]);

export function createSettingsService(runtime: () => Promise<StatusRuntimeContext>) {
  async function read(): Promise<SettingsSnapshot> {
    const context = await runtime();
    const path = getStatusProviderConfigPath(context.roots.configRoot);
    const document = await readConfigDocument(path);
    const ids = getProviders().map((provider) => provider.id);
    return { path, revision: document.revision, fields: SETTINGS.map((definition) => {
      const source = context.configMeta.networkSettingSources[definition.key];
      const readOnly = networkKeys.has(definition.key) && Boolean(source && source !== path && context.configMeta.globalConfigPaths.includes(source));
      return {
        ...definition,
        options: definition.kind === "providers" || definition.kind === "order" ? ids : [...(definition.options ?? [])],
        value: (settingAt(context.config, definition.key) ?? null) as SettingValue,
        readOnly,
      };
    }) };
  }
  return {
    read,
    async save(update: SettingsUpdate): Promise<void> {
      const snapshot = await read();
      if (!update.changes.length) return;
      const seen = new Set<string>();
      const nested: Record<string, unknown> = {};
      for (const change of update.changes) {
        const field = snapshot.fields.find((entry) => entry.key === change.key);
        if (!field || seen.has(change.key)) throw new Error(`Unknown or duplicate setting: ${change.key}`);
        seen.add(change.key);
        if (field.readOnly) throw new Error(`${field.label} is controlled by global configuration.`);
        const value = change.value;
        if (value === null) { if (!field.nullable) throw new Error(`A value is required for ${field.label}`); continue; }
        if (field.kind === "number" && (typeof value !== "number" || !Number.isFinite(value) || (field.key !== "cursorIncludedApiUsd" && !Number.isInteger(value)) || value < field.minimum! || value > field.maximum!)) throw new Error(`Invalid number for ${field.label} (${field.minimum}–${field.maximum})`);
        if (field.kind === "select" && (typeof value !== "string" || !field.options.includes(value))) throw new Error(`Invalid choice for ${field.label}`);
        if (["multi", "providers", "order"].includes(field.kind) && value !== "auto" && (!Array.isArray(value) || value.some((v) => !field.options.includes(v)))) throw new Error(`Invalid list for ${field.label}`);
        const [root, child] = field.key.split(".");
        if (child) {
          nested[root!] ??= {};
          (nested[root!] as Record<string, unknown>)[child] = value;
        }
        else nested[root!] = value;
      }
      const normalized = normalizeStatusProviderUpdate(nested);
      await updateConfigDocument(snapshot.path, update.revision, (existing) => {
        const next = { ...existing };
        for (const change of update.changes) {
          const [root, child] = change.key.split(".");
          if (child) {
            const old = next[root!];
            const object = old && typeof old === "object" && !Array.isArray(old) ? { ...old } as Record<string, unknown> : {};
            if (change.value === null) delete object[child]; else object[child] = settingAt(normalized, change.key);
            next[root!] = object;
          } else if (change.value === null) delete next[root!];
          else next[root!] = normalized[root!];
        }
        return next;
      });
    },
  };
}
