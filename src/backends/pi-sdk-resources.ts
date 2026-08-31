import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { DefaultResourceLoader, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

import { assessReadOnlyToolCall } from "./project-read-boundary.js";
import type { AgentSessionRequest } from "./pi-sdk-plan-agents.js";

export async function createSafeSettings(): Promise<SettingsManager> {
  const selected: {
    defaultProvider?: string;
    defaultModel?: string;
    defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  } = {};
  try {
    const parsed = JSON.parse(await readFile(join(getAgentDir(), "settings.json"), "utf8")) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const settings = parsed as Record<string, unknown>;
      if (typeof settings.defaultProvider === "string") selected.defaultProvider = settings.defaultProvider;
      if (typeof settings.defaultModel === "string") selected.defaultModel = settings.defaultModel;
      if (["off", "minimal", "low", "medium", "high", "xhigh"].includes(String(settings.defaultThinkingLevel))) {
        selected.defaultThinkingLevel = settings.defaultThinkingLevel as Exclude<typeof selected.defaultThinkingLevel, undefined>;
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Pi model settings could not be loaded safely");
  }
  return SettingsManager.inMemory(selected);
}

export async function createIsolatedResources(
  request: AgentSessionRequest,
  settingsManager = SettingsManager.inMemory({}),
): Promise<DefaultResourceLoader> {
  const loader = new DefaultResourceLoader({
    cwd: request.cwd,
    agentDir: getAgentDir(),
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: request.systemPrompt,
    appendSystemPrompt: [],
    extensionFactories: [{
      name: "arcwell-project-boundary",
      factory: (pi) => {
        pi.on("tool_call", async (event) => {
          const input = event.input && typeof event.input === "object"
            ? event.input as Record<string, unknown>
            : {};
          if (event.toolName === request.submitTool) return undefined;
          if (request.role === "worker" && event.toolName === "write_file"
            && typeof input.path === "string" && request.allowedFiles.includes(input.path)) return undefined;
          const decision = assessReadOnlyToolCall(request.cwd, event.toolName, input);
          if (!decision.block) return undefined;
          return decision.reason ? { block: true, reason: decision.reason } : { block: true };
        });
      },
    }],
  });
  await loader.reload();
  return loader;
}
