import type { ModuleName, SetupManifest } from "./types.js";

export type CatalogCapability = ModuleName | "redaction";

export interface CatalogEntry {
  id: string;
  capability: CatalogCapability;
  source: string;
  /**
   * The published tarball's Subresource Integrity hash, from
   * `npm view <source> dist.integrity`.
   *
   * A version number says which release was asked for; this says which bytes were audited. npm
   * records the same value per package in `node_modules/.package-lock.json` when it installs,
   * so setup and doctor can compare without fetching anything.
   */
  integrity: string;
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
  { id: "pi-lsp", capability: "lsp", source: "npm:@spences10/pi-lsp@0.0.46", integrity: "sha512-bOP9ph8KKEt7Ft5F8ZsAax8qJMl8h6ZMnZRNQvFc5m9Gilwm2e05gNPYVIMwo5/wr+lko9dS/cQsFk9kD1dTpg==", defaultEnabled: true, optional: false, conflictsWith: [] },
  { id: "pi-context", capability: "context", source: "npm:@spences10/pi-context@0.1.16", integrity: "sha512-g/4Plpv70/GzY+3AzbksB+r2ygnLuVezZVmN+7qwDJKe2U3PtO0/GOFmCSvgdyGZT8ktPYsn+G4aMhtHeZC6FQ==", defaultEnabled: true, optional: false, conflictsWith: [] },
  { id: "pi-mcp", capability: "mcp", source: "npm:@spences10/pi-mcp@0.0.60", integrity: "sha512-pYRHpkOqvbjrVC7PIuJl1yFSuiLNvtZZAyR4Nna63uF26zO59YRtHz5Znl79lMPKIxtfEbQemEi7lPVUElH35Q==", defaultEnabled: true, optional: false, conflictsWith: [] },
  { id: "pi-subagents", capability: "subagents", source: "npm:pi-subagents@0.62.0", integrity: "sha512-Zup0siBTtfvI9mE1oraIMW/ahzyxOg/HPQAlHPw6L6rw4qdHK6B91XhJIFrt4oiPeWuauZm/d15n7HkliqXmnw==", defaultEnabled: true, optional: false, conflictsWith: [] },
  { id: "pi-goal", capability: "goal", source: "npm:@narumitw/pi-goal@0.54.4", integrity: "sha512-WqGGYnX5YBaEUlkC2Lh3sFHizJ6/hiGBijybOBv/7RRDZvpMdfygORIl5OHhzqSPekC9+z0ROxiCzPE6hS17jQ==", defaultEnabled: true, optional: false, conflictsWith: [] },
  { id: "pi-redact", capability: "redaction", source: "npm:@spences10/pi-redact@0.0.15", integrity: "sha512-kLoUky/vY8a6shTnHe15p1S0EdAjyzW/kx8u64rwkQUTAQzFWbwQpS7cGJ5a6YC1/Zw63/wFfEVUiIvLm3MEUA==", defaultEnabled: true, optional: false, conflictsWith: [] },
  // Off by default, and the only entry that is: it routes Anthropic through the Claude CLI, so
  // it is right for a subscription login and pointless for an API key or another provider.
  // Arcwell does not know which you use; `doctor` reads the configured provider and says so.
  { id: "pi-claude-cli", capability: "claudeCli", source: "npm:pi-claude-cli@0.3.1", integrity: "sha512-WsvG3fVQquxENC7+NTNaaQthbSqHHnNAwg0cYEsnSokOCnTyQA5rVhVpd7gGTVYZAFzkLxS7SPZlnEDq8uyS1g==", defaultEnabled: false, optional: true, conflictsWith: [] },
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
/** Base64 sha512 SRI, the form npm publishes and records. */
export const integrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/;

export function validateCatalog(entries: readonly CatalogEntry[]): void {
  const ids = new Set<string>();
  const owners = new Set<CatalogCapability>();
  for (const entry of entries) {
    if (!exactNpmSource.test(entry.source)) throw new Error(`${entry.id}: package source must contain an exact npm version`);
    if (!integrityPattern.test(entry.integrity)) throw new Error(`${entry.id}: package integrity must be a sha512 SRI hash`);
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
