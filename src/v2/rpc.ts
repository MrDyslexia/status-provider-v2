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

export const StatusProviderRpc = Rpc.define({
  id: "status-provider",
  methods: {
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
