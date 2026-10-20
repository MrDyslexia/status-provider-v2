/**
 * RPC contract between the status-provider server plugin and its TUI/CLI clients.
 *
 * `surfaces` ships structured per-entry data (percent/value, group, reset time)
 * so the TUI renders its own panels; `toast`/`info` remain pre-rendered text,
 * since a host toast is a plain string and the info report is a diagnostics
 * dump. Credentials and raw provider responses never cross this boundary.
 */

import { Rpc } from "@opencode/plugin/rpc";

const requestSchema = {
  type: "object",
  properties: {
    providerFilter: { type: "string" },
    sessionID: { type: "string" },
    surface: { type: "string", enum: ["home", "session"] },
    trigger: { type: "string", enum: ["manual", "idle", "question", "compact"] },
    currentModel: { type: "string" },
    currentProviderID: { type: "string" },
  },
  additionalProperties: false,
} as const;

const snapshotEntrySchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["percent", "value"] },
    name: { type: "string" },
    group: { type: "string" },
    label: { type: "string" },
    right: { type: "string" },
    resetTimeIso: { type: "string" },
    percentRemaining: { type: "number" },
    displayPercent: { type: "number" },
    displayUnit: { type: "string", enum: ["left", "used"] },
    value: { type: "string" },
  },
  required: ["kind", "name"],
  additionalProperties: false,
} as const;

const snapshotErrorSchema = {
  type: "object",
  properties: {
    label: { type: "string" },
    message: { type: "string" },
    retryable: { type: "boolean" },
  },
  required: ["label", "message"],
  additionalProperties: false,
} as const;

const panelSnapshotSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["disabled", "loading", "ready"] },
    entries: { type: "array", items: snapshotEntrySchema },
    errors: { type: "array", items: snapshotErrorSchema },
    tokenUsage: {
      type: "object",
      properties: { input: { type: "number" }, cachedInput: { type: "number" }, output: { type: "number" } },
      required: ["input", "cachedInput", "output"],
      additionalProperties: false,
    },
  },
  required: ["status", "entries", "errors"],
  additionalProperties: false,
} as const;

const settingValueSchema = { anyOf: [
  { type: "boolean" }, { type: "number" }, { type: "string" }, { type: "null" },
  { type: "array", items: { type: "string" } },
] } as const;
const settingFieldSchema = {
  type: "object",
  properties: {
    key: { type: "string" }, label: { type: "string" }, group: { type: "string" },
    kind: { type: "string", enum: ["boolean", "number", "select", "multi", "providers", "order"] },
    options: { type: "array", items: { type: "string" } },
    value: settingValueSchema, readOnly: { type: "boolean" },
    minimum: { type: "number" }, maximum: { type: "number" }, nullable: { type: "boolean" },
  },
  required: ["key", "label", "group", "kind", "value", "options", "readOnly"],
  additionalProperties: false,
} as const;

export const StatusProviderRpc = Rpc.define({
  id: "status-provider",
  methods: {
    settingsRead: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object", properties: { path: { type: "string" }, revision: { type: "string" }, fields: { type: "array", items: settingFieldSchema } },
        required: ["path", "revision", "fields"], additionalProperties: false,
      },
    },
    settingsSave: {
      input: {
        type: "object", properties: {
          revision: { type: "string" },
          changes: { type: "array", maxItems: 100, items: {
            type: "object", properties: { key: { type: "string" }, value: settingValueSchema },
            required: ["key", "value"], additionalProperties: false,
          } },
        }, required: ["revision", "changes"], additionalProperties: false,
      },
      output: { type: "object", properties: { saved: { type: "boolean" } }, required: ["saved"], additionalProperties: false },
      errors: { settings_error: { type: "null" } },
    },
    details: {
      input: { ...requestSchema, properties: { ...requestSchema.properties, refresh: { type: "boolean" } } },
      output: {
        type: "object",
        properties: {
          generatedAt: { type: "number" },
          selectedProviderID: { anyOf: [{ type: "string" }, { type: "null" }] },
          providers: { type: "array", items: {
            type: "object",
            properties: { id: { type: "string" }, label: { type: "string" }, available: { type: "boolean" }, enabled: { type: "boolean" } },
            required: ["id", "label", "available", "enabled"], additionalProperties: false,
          } },
          panel: panelSnapshotSchema,
        },
        required: ["generatedAt", "selectedProviderID", "providers", "panel"],
        additionalProperties: false,
      },
    },
    info: {
      input: requestSchema,
      output: {
        type: "object",
        properties: { report: { type: "string" } },
        required: ["report"],
        additionalProperties: false,
      },
    },
    surfaces: {
      input: requestSchema,
      output: {
        type: "object",
        properties: {
          generatedAt: { type: "number" },
          sidebar: panelSnapshotSchema,
          compact: panelSnapshotSchema,
          showSessionTimer: { type: "boolean" },
          compactMaxWidth: { type: "number" },
        },
        required: ["generatedAt", "sidebar", "compact", "showSessionTimer", "compactMaxWidth"],
        additionalProperties: false,
      },
    },
    toast: {
      input: requestSchema,
      output: {
        type: "object",
        properties: {
          generatedAt: { type: "number" },
          toast: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                properties: { message: { type: "string" }, duration: { type: "number" } },
                required: ["message", "duration"],
                additionalProperties: false,
              },
            ],
          },
        },
        required: ["generatedAt", "toast"],
        additionalProperties: false,
      },
    },
  },
  events: {},
});

/** Wire shapes. JSON Schema outputs are `unknown` in TypeScript, so clients narrow with these. */
export type PanelStatusWire = "disabled" | "loading" | "ready";

export type SnapshotEntryWire =
  | {
      kind: "percent";
      name: string;
      group?: string;
      label?: string;
      right?: string;
      resetTimeIso?: string;
      percentRemaining: number;
      displayPercent: number;
      displayUnit: "left" | "used";
    }
  | {
      kind: "value";
      name: string;
      group?: string;
      label?: string;
      right?: string;
      resetTimeIso?: string;
      value: string;
    };

export interface SnapshotErrorWire {
  label: string;
  message: string;
  retryable?: boolean;
}

export interface PanelSnapshotWire {
  status: PanelStatusWire;
  entries: SnapshotEntryWire[];
  errors: SnapshotErrorWire[];
  tokenUsage?: { input: number; cachedInput: number; output: number };
}

export interface SurfacesWire {
  generatedAt: number;
  sidebar: PanelSnapshotWire;
  compact: PanelSnapshotWire;
  showSessionTimer: boolean;
  compactMaxWidth: number;
}

export interface ToastWire {
  generatedAt: number;
  toast: { message: string; duration: number } | null;
}

export interface InfoWire {
  report: string;
}

export interface ProviderOptionWire {
  id: string;
  label: string;
  available: boolean;
  enabled: boolean;
}

export interface DetailsWire {
  generatedAt: number;
  selectedProviderID: string | null;
  providers: ProviderOptionWire[];
  panel: PanelSnapshotWire;
}
