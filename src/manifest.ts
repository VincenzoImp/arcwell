import { readFileSync } from "node:fs";

export const profiles = ["core", "full", "custom"] as const;
export const postures = ["host", "guarded", "isolated"] as const;
export const packNames = ["core", "engineering", "release", "security"] as const;
export const workflowNames = ["audit", "bugfix", "feature", "plan", "release", "research", "review"] as const;
export const moduleNames = ["claudeCode", "herdr", "mcp", "sandbox"] as const;

export type Profile = (typeof profiles)[number];
export type Posture = (typeof postures)[number];
export type PackName = (typeof packNames)[number];
export type WorkflowName = (typeof workflowNames)[number];
export type ModuleName = (typeof moduleNames)[number];

export interface ArcwellManifest {
  schemaVersion: 1;
  profile: Profile;
  posture: Posture;
  intelligence: {
    packs: PackName[];
    workflows: WorkflowName[];
  };
  modules: Record<ModuleName, boolean>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function rejectUnknown(path: string, value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${path}${path ? "." : ""}${unknown}: unknown property`);
}

function enumValue<T extends string>(path: string, value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${path}: expected one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function enumList<T extends string>(path: string, value: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(value)) throw new Error(`${path}: expected an array`);
  const parsed = value.map((entry, index) => enumValue(`${path}[${index}]`, entry, allowed));
  if (new Set(parsed).size !== parsed.length) throw new Error(`${path}: duplicate values are not allowed`);
  return parsed;
}

export function parseManifest(value: unknown): ArcwellManifest {
  if (!isRecord(value)) throw new Error("manifest: expected a JSON object");
  rejectUnknown("", value, ["schemaVersion", "profile", "posture", "intelligence", "modules"]);
  if (value.schemaVersion !== 1) {
    throw new Error(`schemaVersion: expected 1, found ${JSON.stringify(value.schemaVersion)}`);
  }

  const profile = enumValue("profile", value.profile, profiles);
  const posture = enumValue("posture", value.posture, postures);
  if (!isRecord(value.intelligence)) throw new Error("intelligence: expected an object");
  rejectUnknown("intelligence", value.intelligence, ["packs", "workflows"]);
  if (!isRecord(value.modules)) throw new Error("modules: expected an object");
  const modulesInput = value.modules;

  const modules = Object.fromEntries(
    moduleNames.map((name) => {
      const enabled = modulesInput[name];
      if (typeof enabled !== "boolean") throw new Error(`modules.${name}: expected a boolean`);
      return [name, enabled];
    }),
  ) as Record<ModuleName, boolean>;

  rejectUnknown("modules", modulesInput, moduleNames);

  const packs = enumList("intelligence.packs", value.intelligence.packs, packNames);
  const workflows = enumList("intelligence.workflows", value.intelligence.workflows, workflowNames);
  const requiredPacks: PackName[] = profile === "full" ? ["core", "engineering", "security"] : profile === "core" ? ["core"] : [];
  const requiredWorkflows: WorkflowName[] = profile === "full"
    ? ["audit", "bugfix", "feature", "plan", "research", "review"]
    : profile === "core" ? ["bugfix", "feature", "plan", "review"] : [];
  for (const required of requiredPacks) {
    if (!packs.includes(required)) throw new Error(`profile ${profile}: intelligence.packs must include ${required}`);
  }
  for (const required of requiredWorkflows) {
    if (!workflows.includes(required)) throw new Error(`profile ${profile}: intelligence.workflows must include ${required}`);
  }
  if (profile !== "custom" && (!modules.mcp || !modules.claudeCode)) {
    throw new Error(`profile ${profile}: modules.mcp and modules.claudeCode must be true`);
  }
  if (posture === "isolated" && !modules.sandbox) {
    throw new Error("posture isolated: modules.sandbox must be true");
  }

  return {
    schemaVersion: 1,
    profile,
    posture,
    intelligence: {
      packs,
      workflows,
    },
    modules,
  };
}

export function loadManifest(path: string): ArcwellManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`manifest: could not read valid JSON (${error instanceof Error ? error.message : error})`);
  }
  return parseManifest(parsed);
}
