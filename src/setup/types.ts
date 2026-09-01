export const protectionNames = ["effects", "secrets", "redaction"] as const;

/**
 * A capability earns a manifest switch when turning it off is a decision with consequences:
 * it spawns processes, spends money, or writes to disk every session. Todo, questionnaire,
 * plan mode and the web skill ship inside Arcwell and are disabled with `pi config`, which
 * already handles every skill, prompt and extension individually.
 */
export const moduleNames = ["lsp", "context", "mcp", "subagents", "goal", "memory"] as const;

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
