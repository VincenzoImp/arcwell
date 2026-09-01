export const protectionNames = ["effects", "secrets", "redaction"] as const;

// Only capabilities that a separate package owns. Todo, questionnaire, plan mode, subagents
// and web ship inside Arcwell now, so they are not switches over an external package: use
// `pi config` to disable one of Arcwell's own resources.
export const moduleNames = ["lsp", "context", "mcp"] as const;

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
