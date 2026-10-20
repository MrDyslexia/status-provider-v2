import { readAuthFile } from "./opencode-auth.js";
import {
  createProviderApiKeyResolver,
  getGlobalOpencodeConfigCandidatePaths,
} from "./api-key-resolver.js";

export interface OllamaCloudApiKeyResult {
  key: string;
  source: OllamaCloudKeySource;
}

const ALLOWED_OLLAMA_CLOUD_ENV_VARS = ["OLLAMA_API_KEY"] as const;
// OpenCode v2 stores this integration as "ollama-cloud"; "ollama" is the common v1/config alias.
const OLLAMA_CLOUD_PROVIDER_KEYS = ["ollama-cloud", "ollama"] as const;

export type OllamaCloudKeySource =
  | "env:OLLAMA_API_KEY"
  | "opencode.json"
  | "opencode.jsonc"
  | "auth.json";

const ollamaCloudApiKeyResolver = createProviderApiKeyResolver<OllamaCloudKeySource>({
  envVars: [{ name: "OLLAMA_API_KEY", source: "env:OLLAMA_API_KEY" }],
  providerKeys: OLLAMA_CLOUD_PROVIDER_KEYS,
  allowedEnvVars: ALLOWED_OLLAMA_CLOUD_ENV_VARS,
  configJsonSource: "opencode.json",
  configJsoncSource: "opencode.jsonc",
  getConfigCandidates: getGlobalOpencodeConfigCandidatePaths,
  auth: {
    readAuth: readAuthFile,
    authSource: "auth.json",
  },
});

export async function resolveOllamaCloudApiKey(): Promise<OllamaCloudApiKeyResult | null> {
  return ollamaCloudApiKeyResolver.resolve();
}

export async function hasOllamaCloudApiKey(): Promise<boolean> {
  return ollamaCloudApiKeyResolver.has();
}

export async function getOllamaCloudKeyDiagnostics(): Promise<{
  configured: boolean;
  source: OllamaCloudKeySource | null;
  checkedPaths: string[];
}> {
  return ollamaCloudApiKeyResolver.diagnostics();
}
