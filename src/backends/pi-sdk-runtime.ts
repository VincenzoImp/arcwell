import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type CredentialStore,
} from "@earendil-works/pi-ai";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";

async function clonePiCredentials(signal?: AbortSignal): Promise<InMemoryCredentialStore> {
  const packageEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  const moduleUrl = pathToFileURL(join(dirname(packageEntry), "core", "auth-storage.js")).href;
  const storageModule = await import(moduleUrl) as {
    ReadOnlyAuthStorage: new (path?: string) => CredentialStore;
  };
  const source = new storageModule.ReadOnlyAuthStorage(join(getAgentDir(), "auth.json"));
  const target = new InMemoryCredentialStore();
  for (const entry of await source.list(signal ? { signal } : undefined)) {
    const credential = await source.read(entry.providerId, signal ? { signal } : undefined);
    if (credential) await target.modify(entry.providerId, async () => credential, signal ? { signal } : undefined);
  }
  return target;
}

export async function createEphemeralModelRuntime(signal?: AbortSignal): Promise<ModelRuntime> {
  const credentials = await clonePiCredentials(signal);
  const agentDir = getAgentDir();
  return ModelRuntime.create({
    credentials,
    modelsPath: join(agentDir, "models.json"),
    modelsStore: new InMemoryModelsStore(),
    allowModelNetwork: false,
    refreshOnCreate: true,
    ...(signal ? { signal } : {}),
  });
}
