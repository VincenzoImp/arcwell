import { selectedCatalogEntries } from "./catalog.js";
import { ARCWELL_VERSION, manifestDigest } from "./manifest.js";
import { ARCWELL_PACKAGE_SOURCE } from "./package-source.js";
import { protectionNames, type SetupManifest } from "./types.js";

export type SetupOperationKind = "install-package" | "merge-agreement" | "write-config";

export interface SetupOperation {
  id: string;
  kind: SetupOperationKind;
  description: string;
  source?: string;
  destination?: string;
}

export interface SetupPlan {
  schemaVersion: 1;
  arcwellVersion: string;
  manifestDigest: string;
  operations: SetupOperation[];
  warnings: string[];
  notes: string[];
}

export function createSetupPlan(manifest: SetupManifest): SetupPlan {
  const packageOperations: SetupOperation[] = selectedCatalogEntries(manifest)
    .map((entry) => ({
      id: `package.${entry.capability}`,
      kind: "install-package" as const,
      source: entry.source,
      description: `Select ${entry.source} as the sole owner of ${entry.capability}`,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const operations: SetupOperation[] = [
    {
      id: "package.arcwell",
      kind: "install-package",
      source: ARCWELL_PACKAGE_SOURCE,
      description: "Select the exact running Arcwell Pi package",
    },
    ...packageOperations,
    {
      id: "agreement.arcwell",
      kind: "merge-agreement",
      source: "content/AGENTS.md",
      destination: "$PI_CODING_AGENT_DIR/AGENTS.md",
      description: "Merge the marked Arcwell working agreement block",
    },
    {
      id: "config.arcwell",
      kind: "write-config",
      destination: "$PI_CODING_AGENT_DIR/arcwell/config.json",
      description: "Write bounded non-secret effective protection configuration",
    },
  ];

  const warnings = protectionNames
    .filter((name) => !manifest.protections[name])
    .map((name) => `Protection ${name} is disabled by the manifest`);
  const notes = manifest.providerGuidance.claudeSubscription
    ? ["Claude subscription authentication remains Pi-native; use /login in Pi. Arcwell never reads authentication state."]
    : [];

  return {
    schemaVersion: 1,
    arcwellVersion: ARCWELL_VERSION,
    manifestDigest: manifestDigest(manifest),
    operations,
    warnings,
    notes,
  };
}
