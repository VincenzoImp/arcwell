import { createHash } from "node:crypto";

import type { FeaturePreparationResult } from "./feature-preparation.js";
import { validatePlanArtifact, validateScoutArtifact, type PlanArtifact, type ScoutArtifact } from "./plan.js";

export interface ProjectSnapshot {
  algorithm: "sha256-relevant-files-v1";
  digest: string;
  fileCount: number;
}

export interface StoredFeatureCheckpoint {
  schemaVersion: 1;
  checkpoint: ResumableFeatureCheckpoint;
  projectSnapshot: ProjectSnapshot;
}

export interface ResumableFeatureCheckpoint {
  schemaVersion: 1;
  workflow: "feature";
  graphDigest: string;
  status: "blocked";
  completedNodes: ["scout", "plan"];
  currentGate: { id: "approve-plan"; approval: "user"; approved: false };
  artifacts: {
    "project-map": ScoutArtifact;
    "implementation-plan": PlanArtifact;
    "task-partitions": PlanArtifact["steps"];
  };
  remainingWaves: Array<{ index: number; nodes: string[]; agents: number }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key));
}

function validWaves(value: unknown): value is ResumableFeatureCheckpoint["remainingWaves"] {
  return Array.isArray(value) && value.every((wave) => isRecord(wave)
    && hasOnlyKeys(wave, ["index", "nodes", "agents"])
    && Number.isInteger(wave.index) && (wave.index as number) >= 0
    && Number.isInteger(wave.agents) && (wave.agents as number) >= 0
    && Array.isArray(wave.nodes) && wave.nodes.every((node) => typeof node === "string" && node.length > 0));
}

export function parseResumableFeatureCheckpoint(value: unknown, cwd: string): ResumableFeatureCheckpoint {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "schemaVersion", "workflow", "graphDigest", "status", "completedNodes", "currentGate", "artifacts", "remainingWaves",
  ])) throw new Error("feature checkpoint has an invalid top-level contract");
  if (value.schemaVersion !== 1 || value.workflow !== "feature" || value.status !== "blocked"
    || typeof value.graphDigest !== "string" || !/^[0-9a-f]{64}$/.test(value.graphDigest)) {
    throw new Error("feature checkpoint identity is invalid");
  }
  if (!Array.isArray(value.completedNodes) || value.completedNodes.length !== 2
    || value.completedNodes[0] !== "scout" || value.completedNodes[1] !== "plan") {
    throw new Error("feature checkpoint does not complete the required read-only nodes");
  }
  if (!isRecord(value.currentGate) || !hasOnlyKeys(value.currentGate, ["id", "approval", "approved"])
    || value.currentGate.id !== "approve-plan" || value.currentGate.approval !== "user" || value.currentGate.approved !== false) {
    throw new Error("feature checkpoint is not blocked at approve-plan");
  }
  if (!isRecord(value.artifacts)
    || !hasOnlyKeys(value.artifacts, ["project-map", "implementation-plan", "task-partitions"])
    || !validateScoutArtifact(value.artifacts["project-map"], cwd)
    || !validatePlanArtifact(value.artifacts["implementation-plan"], cwd)
    || !Array.isArray(value.artifacts["task-partitions"])
    || JSON.stringify(value.artifacts["task-partitions"]) !== JSON.stringify(value.artifacts["implementation-plan"].steps)) {
    throw new Error("feature checkpoint artifacts are invalid or inconsistent");
  }
  if (!validWaves(value.remainingWaves)) throw new Error("feature checkpoint waves are invalid");
  return structuredClone(value) as unknown as ResumableFeatureCheckpoint;
}

export function parseStoredFeatureCheckpoint(value: unknown, cwd: string): StoredFeatureCheckpoint {
  if (!isRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "checkpoint", "projectSnapshot"])
    || value.schemaVersion !== 1 || !isRecord(value.projectSnapshot)
    || !hasOnlyKeys(value.projectSnapshot, ["algorithm", "digest", "fileCount"])
    || value.projectSnapshot.algorithm !== "sha256-relevant-files-v1"
    || typeof value.projectSnapshot.digest !== "string" || !/^[0-9a-f]{64}$/.test(value.projectSnapshot.digest)
    || !Number.isInteger(value.projectSnapshot.fileCount) || (value.projectSnapshot.fileCount as number) < 0) {
    throw new Error("stored feature checkpoint contract is invalid");
  }
  return {
    schemaVersion: 1,
    checkpoint: parseResumableFeatureCheckpoint(value.checkpoint, cwd),
    projectSnapshot: structuredClone(value.projectSnapshot) as unknown as ProjectSnapshot,
  };
}

export function storedFeatureCheckpointDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function assertResumableFeatureCheckpoint(
  value: FeaturePreparationResult,
  cwd: string,
): ResumableFeatureCheckpoint {
  return parseResumableFeatureCheckpoint(value, cwd);
}
