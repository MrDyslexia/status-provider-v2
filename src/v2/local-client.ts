import { OpenCode, type OpenCodeClient } from "@opencode/client";
import { discover, headers } from "@opencode/client/service";
import { StatusProviderRpc, type ToastWire } from "./rpc.js";

/** Discover only: CLI commands must not start or mutate the host service. */
export async function localClient(): Promise<OpenCodeClient | undefined> {
  const endpoint = await discover();
  return endpoint ? OpenCode.make({ baseUrl: endpoint.url, headers: headers(endpoint) }) : undefined;
}

export async function activeProviderIds(): Promise<string[] | undefined> {
  try {
    const client = await localClient();
    return client ? (await client.provider.list()).data.map((p) => p.id) : undefined;
  } catch { return undefined; }
}

export async function runV2Show(argv: string[]): Promise<number> {
  if (argv.some((arg) => arg === "--help" || arg === "-h")) {
    console.log("Usage: status-provider show [--provider <provider-id>]");
    return 0;
  }
  let provider: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--provider" && argv[i + 1] && !provider) provider = argv[++i];
    else if (arg?.startsWith("--provider=") && !provider) provider = arg.slice(11);
    else { console.error(`Unknown argument: ${arg}`); return 1; }
  }
  const client = await localClient();
  if (!client) { console.error("No OpenCode v2 service found. Start OpenCode before running show."); return 1; }
  try {
    const result = await client.rpc(StatusProviderRpc).toast({
      ...(provider ? { providerFilter: provider } : {}),
    }, { location: { directory: process.cwd() } }) as ToastWire;
    console.log(result.toast?.message ?? "No quota data available");
    return 0;
  } catch { console.error("Could not query status-provider on OpenCode v2. Check plugin installation."); return 1; }
}
