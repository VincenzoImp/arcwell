export const protectionNames = ["effects", "secrets", "redaction"] as const;
export const moduleNames = [
  "lsp",
  "context",
  "todo",
  "questionnaire",
  "planMode",
  "mcp",
  "web",
  "subagents",
  "autonomousWorkflows",
] as const;

export type ProtectionName = (typeof protectionNames)[number];
export type ModuleName = (typeof moduleNames)[number];

export interface SetupManifest {
  schemaVersion: 1;
  arcwellVersion: string;
  profile: "core";
  posture: "guarded" | "host";
  protections: Record<ProtectionName, boolean>;
  providerGuidance: {
    claudeSubscription: boolean;
  };
  modules: Record<ModuleName, boolean>;
}

export interface RuntimeConfig {
  schemaVersion: 1;
  posture: SetupManifest["posture"];
  protections: Record<ProtectionName, boolean>;
}
