import { createHash } from "node:crypto";

import { capabilityById, type CapabilityKind } from "./catalog.js";
import type { ArcwellManifest, PackName, WorkflowName } from "./manifest.js";
import { compareText } from "./order.js";

export interface PlanOperation {
  id: string;
  kind: CapabilityKind;
  description: string;
  requiresApproval: boolean;
  platforms: string[];
}

export interface ArcwellPlan {
  schemaVersion: 1;
  manifestDigest: string;
  selection: {
    profile: ArcwellManifest["profile"];
    posture: ArcwellManifest["posture"];
    intelligencePacks: PackName[];
    workflows: WorkflowName[];
    executionBackend: "subagent" | "herdr";
  };
  operations: PlanOperation[];
  warnings: string[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function operation(id: string): PlanOperation {
  const selected = capabilityById(id);
  return {
    id: selected.id,
    kind: selected.kind,
    description: selected.description,
    requiresApproval: selected.requiresApproval,
    platforms: selected.platforms,
  };
}

export function createPlan(manifest: ArcwellManifest): ArcwellPlan {
  const packs = [...new Set(manifest.intelligence.packs)].sort();
  const workflows = [...new Set(manifest.intelligence.workflows)].sort();
  const operations: PlanOperation[] = [operation("config.working-agreement")];

  for (const pack of packs) operations.push(operation(`intelligence.pack.${pack}`));
  for (const workflow of workflows) operations.push(operation(`intelligence.workflow.${workflow}`));

  if (manifest.posture !== "host") operations.push(operation("policy.effects-guard"));
  if (manifest.posture === "isolated" || manifest.modules.sandbox) operations.push(operation("policy.sandbox"));
  if (manifest.modules.mcp) operations.push(operation("integration.mcp"));
  if (manifest.modules.claudeCode) operations.push(operation("integration.claude-code"));
  if (manifest.modules.herdr) {
    operations.push(operation("integration.herdr"));
    operations.push(operation("integration.herdr.pi"));
  }

  operations.sort((left, right) => compareText(left.id, right.id));
  const warnings: string[] = [];
  if (manifest.modules.herdr) {
    warnings.push("Herdr is available only for explicitly persistent nodes and will be installed only after approval");
  }

  const normalizedManifest = {
    ...manifest,
    intelligence: { packs, workflows },
  };
  return {
    schemaVersion: 1,
    manifestDigest: createHash("sha256").update(canonical(normalizedManifest)).digest("hex"),
    selection: {
      profile: manifest.profile,
      posture: manifest.posture,
      intelligencePacks: packs,
      workflows,
      executionBackend: "subagent",
    },
    operations,
    warnings,
  };
}
