export const protectionNames = ["effects", "secrets", "redaction"] as const;

/**
 * One module, one external package. A switch here decides whether Arcwell asks Pi to install
 * something; it is not a general on/off for capabilities.
 *
 * Everything Arcwell ships itself — the todo overlay, structured questions, plan mode, the web
 * skill, the memory extension — is disabled with `pi config`, which already handles every
 * skill, prompt and extension individually, globally or per project. Mirroring that here would
 * double the matrix to test and give two answers to the same question.
 */
export const moduleNames = ["lsp", "context", "mcp", "subagents", "goal", "claudeCli"] as const;

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
