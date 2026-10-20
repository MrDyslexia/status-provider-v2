import type { ProviderSelectionWire } from "./rpc.js";
import type { SettingsUpdate } from "./settings-model.js";
import { displayError } from "./sidebar-presentation.js";

export interface ProviderMenuState {
  open: boolean; loading: boolean; saving: boolean; error: string;
  data: ProviderSelectionWire | null;
}
export function createProviderMenuController(deps: {
  load(signal: AbortSignal): Promise<ProviderSelectionWire>;
  save(update: SettingsUpdate, signal: AbortSignal): Promise<unknown>;
  changed(): void;
  render(state: ProviderMenuState): void;
}) {
  let state: ProviderMenuState = { open: false, loading: false, saving: false, error: "", data: null };
  let disposed = false; let generation = 0;
  let read: AbortController | undefined;
  const lifetime = new AbortController();
  function patch(value: Partial<ProviderMenuState>) {
    if (disposed) return;
    state = { ...state, ...value }; deps.render(state);
  }
  async function reload() {
    if (disposed || !state.open) return;
    const current = ++generation;
    read?.abort(); const controller = read = new AbortController();
    patch({ loading: true, error: "" });
    try {
      const data = await deps.load(controller.signal);
      if (!disposed && generation === current) patch({ data, loading: false });
    } catch (error) {
      if (!disposed && generation === current) patch({ error: displayError(error), loading: false });
    }
  }
  function close() { generation++; read?.abort(); patch({ open: false, loading: false }); }
  return {
    get state() { return state; },
    async open() { if (disposed) return; patch({ open: true }); await reload(); },
    close,
    reload,
    async toggle(id: string) {
      const before = state.data;
      if (!before || disposed || !state.open || state.saving || state.loading || state.error || before.readOnly) return;
      if (id !== "@auto" && !before.providers.some((provider) => provider.id === id)) return;
      const auto = id === "@auto" && before.mode !== "auto";
      const selected = id === "@auto" ? [...before.selected] : before.selected.includes(id)
        ? before.selected.filter((value) => value !== id) : [...before.selected, id];
      patch({ saving: true, data: { ...before, mode: auto ? "auto" : "manual", selected } });
      let saved = false;
      try {
        await deps.save({ revision: before.revision, changes: [{ key: "enabledProviders", value: auto ? "auto" : selected }] }, lifetime.signal);
        saved = true;
        if (disposed) return;
        deps.changed();
        if (state.open) await reload();
      } catch (error) {
        if (!disposed) patch({ data: saved ? state.data : before, error: displayError(error) });
      } finally { patch({ saving: false }); }
    },
    dispose() { close(); disposed = true; lifetime.abort(); },
  };
}
