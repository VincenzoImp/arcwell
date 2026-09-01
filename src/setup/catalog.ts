import type { ModuleName, SetupManifest } from "./types.js";

export type CatalogCapability = ModuleName | "redaction";

export interface CatalogEntry {
  id: string;
  capability: CatalogCapability;
  source: string;
  defaultEnabled: boolean;
  optional: boolean;
  conflictsWith: readonly string[];
}

/**
 * A package earns a place here by saving work Arcwell would otherwise have to do: a whole
 * LSP protocol, an MCP client's server lifecycle, a credential dictionary that ages badly
 * when self-written, retrieval logic for oversized output.
 */
export const PACKAGE_CATALOG: readonly CatalogEntry[] = [
  { id: "pi-lsp", capability: "lsp", source: "npm:@spences10/pi-lsp@0.0.46", defaultEnabled: true, optional: false, conflictsWith: [] },
  { id: "pi-context", capability: "context", source: "npm:@spences10/pi-context@0.1.16", defaultEnabled: true, optional: false, conflictsWith: [] },
  { id: "pi-mcp", capability: "mcp", source: "npm:@spences10/pi-mcp@0.0.60", defaultEnabled: true, optional: false, conflictsWith: [] },
  { id: "pi-subagents", capability: "subagents", source: "npm:pi-subagents@0.62.0", defaultEnabled: true, optional: false, conflictsWith: [] },
  { id: "pi-goal", capability: "goal", source: "npm:@narumitw/pi-goal@0.54.4", defaultEnabled: true, optional: false, conflictsWith: [] },
  { id: "pi-redact", capability: "redaction", source: "npm:@spences10/pi-redact@0.0.15", defaultEnabled: true, optional: false, conflictsWith: [] },
];

/**
 * Capabilities Arcwell now ships itself. Installing the package alongside would register the
 * same tool twice and Pi refuses to load either: `Tool "todo" conflicts with ...`.
 */
export const INTERNAL_CAPABILITIES = [
  { capability: "todo", supersedes: "npm:@juicesharp/rpiv-todo" },
  { capability: "questionnaire", supersedes: "npm:@juicesharp/rpiv-ask-user-question" },
  { capability: "plan-mode", supersedes: "npm:@narumitw/pi-plan-mode" },
  { capability: "web", supersedes: "npm:pi-web-access" },
] as const;

export const REJECTED_CAPABILITIES = [
  "coding-preferences",
  "nopeek",
  "confirm-destructive",
  "background-tasks",
  "dynamic-workflows",
  "web-ui",
  "git-checkpoint",
  "notifications",
] as const;

const exactNpmSource = /^npm:(?:@[^/@]+\/)?[^/@]+@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function validateCatalog(entries: readonly CatalogEntry[]): void {
  const ids = new Set<string>();
  const owners = new Set<CatalogCapability>();
  for (const entry of entries) {
    if (!exactNpmSource.test(entry.source)) throw new Error(`${entry.id}: package source must contain an exact npm version`);
    if (ids.has(entry.id)) throw new Error(`duplicate catalog id: ${entry.id}`);
    if (owners.has(entry.capability)) throw new Error(`duplicate owner for capability ${entry.capability}`);
    ids.add(entry.id);
    owners.add(entry.capability);
  }
  for (const entry of entries) {
    const conflict = entry.conflictsWith.find((id) => ids.has(id));
    if (conflict) throw new Error(`catalog conflict: ${entry.id} conflicts with ${conflict}`);
  }
}

export function selectedCatalogEntries(manifest: SetupManifest): CatalogEntry[] {
  validateCatalog(PACKAGE_CATALOG);
  return PACKAGE_CATALOG.filter((entry) =>
    entry.capability === "redaction"
      ? manifest.protections.redaction
      : manifest.modules[entry.capability],
  );
}
