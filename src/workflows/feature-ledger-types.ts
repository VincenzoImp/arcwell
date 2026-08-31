import type { StoredFeatureCheckpoint } from "./feature-checkpoint.js";
import type { FeaturePreparationResult } from "./feature-preparation.js";

export interface FeatureCheckpointReference {
  sessionId: string;
  entryId: string;
  digest: string;
}

export interface LoadedFeatureCheckpoint extends FeatureCheckpointReference {
  stored: StoredFeatureCheckpoint;
}

export interface FeatureWorkerRecord {
  schemaVersion: 1;
  workflow: "feature";
  node: "implement";
  approvalId: string;
  taskId: string;
  workspaceId: string;
  summary: string;
  verificationNotes: string[];
  changes: Array<{
    path: string;
    status: "added" | "modified";
    beforeDigest?: string;
    afterDigest: string;
    bytes: number;
  }>;
}

export interface FeatureLedger {
  saveCheckpoint(cwd: string, checkpoint: FeaturePreparationResult, signal?: AbortSignal): Promise<FeatureCheckpointReference>;
  loadCheckpoint(cwd: string, reference: FeatureCheckpointReference, signal?: AbortSignal): Promise<LoadedFeatureCheckpoint>;
  approvePlan(cwd: string, reference: FeatureCheckpointReference, signal?: AbortSignal): Promise<{ id: string }>;
  requireApproval(cwd: string, reference: FeatureCheckpointReference, approvalId: string, signal?: AbortSignal): Promise<void>;
  recordWorkerResult(
    cwd: string,
    reference: FeatureCheckpointReference,
    record: FeatureWorkerRecord,
    signal?: AbortSignal,
  ): Promise<{ entryId: string }>;
}
