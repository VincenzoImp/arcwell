export const protectionNames = ["effects", "secrets", "redaction"] as const;

/**
 * A module is a switch for something with an external cost: a package Arcwell asks Pi to
 * install, or a system prerequisite setup has to check. It is not a general on/off for
 * capabilities.
 *
 * `sandbox` is the second kind. It ships inside this package, but on Linux it needs
 * `bubblewrap`, `socat` and `ripgrep` present on the host, and setup is the only place that can
 * say so before anyone relies on the containment.
 *
 * Everything Arcwell ships itself — the todo overlay, structured questions, plan mode, the web
 * skill, the memory extension — is disabled with `pi config`, which already handles every
 * skill, prompt and extension individually, globally or per project. Mirroring that here would
 * double the matrix to test and give two answers to the same question.
 */
export const moduleNames = ["lsp", "context", "mcp", "subagents", "goal", "claudeCli", "sandbox"] as const;

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
