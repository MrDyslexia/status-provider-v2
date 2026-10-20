/**
 * RPC contract between the status-provider server plugin and its TUI/CLI clients.
 *
 * Payloads are pre-rendered text surfaces only. Credentials and raw provider
 * data never cross this boundary.
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

const stringArray = { type: "array", items: { type: "string" } } as const;

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
          sidebar: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["disabled", "loading", "ready"] },
              lines: stringArray,
            },
            required: ["status", "lines"],
            additionalProperties: false,
          },
          compact: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["disabled", "loading", "ready"] },
              text: { type: "string" },
            },
            required: ["status"],
            additionalProperties: false,
          },
          showSessionTimer: { type: "boolean" },
        },
        required: ["generatedAt", "sidebar", "compact", "showSessionTimer"],
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

export interface SurfacesWire {
  generatedAt: number;
  sidebar: { status: PanelStatusWire; lines: string[] };
  compact: { status: PanelStatusWire; text?: string };
  showSessionTimer: boolean;
}

export interface ToastWire {
  generatedAt: number;
  toast: { message: string; duration: number } | null;
}

export interface InfoWire {
  report: string;
}
