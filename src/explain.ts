import { capabilityById } from "./catalog.js";
import type { ArcwellManifest } from "./manifest.js";
import { createPlan, type ArcwellPlan } from "./planner.js";

export interface ExplainedCapability {
  id: string;
  description: string;
  activation: "lazy" | "startup";
  platforms: string[];
  requiresApproval: boolean;
  ownership: {
    owner: "arcwell" | "herdr";
    lifecycle: "managed" | "delegated";
  };
  provenance: {
    kind: "curated" | "official-integration";
    source: string;
  };
}

export interface ManifestExplanation {
  schemaVersion: 1;
  manifestDigest: string;
  selection: ArcwellPlan["selection"];
  plan: ArcwellPlan;
  capabilities: ExplainedCapability[];
  guardrails: string[];
}

export function explainManifest(manifest: ArcwellManifest): ManifestExplanation {
  const plan = createPlan(manifest);
  const capabilities = plan.operations.map((operation): ExplainedCapability => {
    const catalog = capabilityById(operation.id);
    const delegated = operation.id === "integration.herdr.pi";
    return {
      id: operation.id,
      description: operation.description,
      activation: catalog.lazy ? "lazy" : "startup",
      platforms: [...catalog.platforms],
      requiresApproval: catalog.requiresApproval,
      ownership: delegated
        ? { owner: "herdr", lifecycle: "delegated" }
        : { owner: "arcwell", lifecycle: "managed" },
      provenance: delegated
        ? { kind: "official-integration", source: "herdr integration install pi" }
        : { kind: "curated", source: `arcwell/catalog/${operation.id}` },
    };
  });

  const guardrails = ["remote effects require explicit authorization", "secrets are never embedded in manifests"];
  if (manifest.posture !== "host") guardrails.push("effects guard is enabled");
  if (manifest.posture === "isolated") guardrails.push("sandbox failure blocks host fallback");

  return {
    schemaVersion: 1,
    manifestDigest: plan.manifestDigest,
    selection: plan.selection,
    plan,
    capabilities,
    guardrails,
  };
}
