import type { Plugin } from "@opencode/plugin/tui";
import type { RpcClient } from "@opencode/client";
import type { StatusProviderRpc } from "./rpc.js";
import type { SettingField, SettingValue, SettingsSnapshot } from "./settings-model.js";
import { displayError } from "./sidebar-presentation.js";

function showValue(value: SettingValue): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "(none)";
  return value === null ? "Default" : String(value);
}

async function editField(context: Plugin.Context, field: SettingField, current: SettingValue): Promise<SettingValue | undefined> {
  const dialog = context.ui.dialog;
  if (field.kind === "boolean") return !current;
  if (field.kind === "select") return dialog.select({
    title: field.label, current: typeof current === "string" ? current : undefined,
    options: field.options.map((value) => ({ title: value, value })),
  });
  if (field.kind === "number" || field.kind === "order") {
    const value = await dialog.prompt({ title: field.label,
      description: field.kind === "order" ? "Provider IDs separated by commas. Empty uses the default order."
        : `${field.minimum}–${field.maximum}${field.nullable ? "; empty restores default" : ""}`,
      value: Array.isArray(current) ? current.join(", ") : current === null ? "" : String(current),
    });
    if (value === undefined) return undefined;
    if (field.kind === "order") {
      const ids = value.split(",").map((id) => id.trim()).filter(Boolean);
      if (ids.some((id) => !field.options.includes(id))) throw new Error("Use registered provider IDs in the order list.");
      return [...new Set(ids)];
    }
    if (!value.trim() && field.nullable) return null;
    const number = Number(value);
    if (!value.trim() || !Number.isFinite(number) || number < field.minimum! || number > field.maximum! || (field.key !== "cursorIncludedApiUsd" && !Number.isInteger(number))) throw new Error(`Enter a valid number from ${field.minimum} to ${field.maximum}.`);
    return number;
  }
  if (field.kind === "providers") {
    const mode = await dialog.select({ title: "Enable providers", current: current === "auto" ? "auto" : "manual",
      options: [{ title: "Auto-detect", value: "auto" }, { title: "Manual list", value: "manual" }],
    });
    if (!mode || mode === "auto") return mode;
  }
  let values = Array.isArray(current) ? [...current] : [];
  let selected = "@done";
  while (true) {
    const choice = await dialog.select({ title: `${field.label} · ${values.length} selected`, current: selected,
      options: [
        { title: "Done", value: "@done" }, { title: "Select all", value: "@all" },
        ...field.options.map((value) => ({ title: `${values.includes(value) ? "[x]" : "[ ]"} ${value}`, value })),
      ],
    });
    if (choice === undefined) return undefined;
    if (choice === "@done") {
      if (field.kind === "multi" && !values.length) { await dialog.alert({ title: field.label, message: "Choose at least one option." }); continue; }
      return values;
    }
    if (choice === "@all") values = [...field.options];
    else { values = values.includes(choice) ? values.filter((value) => value !== choice) : [...values, choice]; selected = choice; }
  }
}

/** Draft-only native dialogs; the only persistent mutation is the explicit Save action. */
export async function configureStatusProvider(context: Plugin.Context, rpc: RpcClient<typeof StatusProviderRpc>,
  signal: AbortSignal, onSaved: () => void): Promise<void> {
  const options = { location: context.location ?? context.data.location.default(), signal };
  let snapshot = await rpc.settingsRead({}, options) as SettingsSnapshot;
  const changes = new Map<string, SettingValue>();
  let current: string | undefined;
  while (!signal.aborted) {
    const choice = await context.ui.dialog.select({
      title: `Status Provider settings · ${changes.size} unsaved`, placeholder: "Find a setting · Esc discards changes", current,
      options: [
        { title: `Save changes (${changes.size})`, value: "@save", disabled: changes.size === 0 },
        { title: "Discard and close", value: "@discard" },
        { title: "Reload (discard unsaved changes)", value: "@reload" },
        { title: "Configuration file", value: "@path", description: snapshot.path },
        ...snapshot.fields.map((field) => ({ title: `${field.label}: ${showValue(changes.has(field.key) ? changes.get(field.key)! : field.value)}`,
          value: field.key, category: field.group,
          description: field.readOnly ? "Controlled by global configuration" : changes.has(field.key) ? "Modified · not saved" : field.key,
        })),
      ],
    });
    if (signal.aborted || choice === undefined || choice === "@discard") return;
    current = choice;
    try {
      if (choice === "@save") {
        await rpc.settingsSave({ revision: snapshot.revision, changes: [...changes].map(([key, value]) => ({ key, value })) }, options);
        if (signal.aborted) return;
        onSaved();
        context.ui.toast.show({ message: "Status Provider settings saved", variant: "success", duration: 5000 });
        return;
      }
      if (choice === "@reload") { snapshot = await rpc.settingsRead({}, options) as SettingsSnapshot; changes.clear(); continue; }
      if (choice === "@path") { await context.ui.dialog.alert({ title: "Configuration file", message: snapshot.path }); continue; }
      const field = snapshot.fields.find((item) => item.key === choice);
      if (!field) continue;
      if (field.readOnly) {
        await context.ui.dialog.alert({ title: field.label, message: "This setting is controlled by global configuration. Edit the global configuration instead." });
        continue;
      }
      const value = await editField(context, field, changes.has(choice) ? changes.get(choice)! : field.value);
      if (signal.aborted || value === undefined) continue;
      if (JSON.stringify(value) === JSON.stringify(field.value)) changes.delete(choice);
      else changes.set(choice, value);
    } catch (error) {
      if (!signal.aborted) context.ui.toast.show({ message: displayError(error), variant: "error", duration: 6000 });
    }
  }
}
