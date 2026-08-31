import { compareText } from "../order.js";
import { featureWorkflow } from "./curated.js";
import { featureGraphDigest } from "./feature-preparation.js";
import type { FeatureCheckpointReference, FeatureLedger } from "./feature-ledger.js";
import { createProjectSnapshot } from "./project-snapshot.js";

export interface FeatureWorkerTask {
  id: string;
  needs: string[];
  description: string;
  files: string[];
  verification: string;
  workspace: "isolated";
}

export interface FeatureResumeResult {
  schemaVersion: 1;
  workflow: "feature";
  graphDigest: string;
  status: "ready";
  completedNodes: ["scout", "plan", "approve-plan"];
  approvedGate: { id: "approve-plan"; approval: "user"; approved: true };
  checkpoint: FeatureCheckpointReference;
  approval: { id: string };
  workerPlan: {
    node: "implement";
    maxConcurrency: number;
    tasks: FeatureWorkerTask[];
    firstWave: string[];
    projectSnapshotRequired: true;
    workersStarted: false;
  };
}

export async function resumeFeatureWorkflow(
  input: FeatureCheckpointReference & { cwd: string; approvePlan: boolean; signal?: AbortSignal },
  ledger: FeatureLedger,
): Promise<FeatureResumeResult> {
  input.signal?.throwIfAborted();
  if (!input.approvePlan) throw new Error("explicit plan approval is required");
  const reference = { sessionId: input.sessionId, entryId: input.entryId, digest: input.digest };
  const loaded = await ledger.loadCheckpoint(input.cwd, reference, input.signal);
  input.signal?.throwIfAborted();
  const currentDigest = featureGraphDigest();
  if (loaded.stored.checkpoint.graphDigest !== currentDigest) {
    throw new Error("workflow graph has changed since the checkpoint was created");
  }
  const implement = featureWorkflow.nodes.find((node) => node.id === "implement");
  if (implement?.kind !== "agent" || implement.access !== "write" || implement.workspace !== "isolated") {
    throw new Error("curated feature worker boundary is invalid");
  }
  const currentSnapshot = await createProjectSnapshot(input.cwd, loaded.stored.checkpoint, input.signal);
  if (currentSnapshot.digest !== loaded.stored.projectSnapshot.digest
    || currentSnapshot.fileCount !== loaded.stored.projectSnapshot.fileCount) {
    throw new Error("project snapshot has changed since the checkpoint was created");
  }
  const tasks = loaded.stored.checkpoint.artifacts["task-partitions"]
    .map((task): FeatureWorkerTask => ({
      id: task.id,
      needs: [...task.needs].sort(compareText),
      description: task.description,
      files: [...task.files].sort(compareText),
      verification: task.verification,
      workspace: "isolated",
    }))
    .sort((left, right) => compareText(left.id, right.id));
  const firstWave = tasks
    .filter((task) => task.needs.length === 0)
    .map((task) => task.id)
    .slice(0, implement.fanOut);
  if (firstWave.length === 0) throw new Error("approved task partition has no runnable root task");
  input.signal?.throwIfAborted();
  const approval = await ledger.approvePlan(input.cwd, reference, input.signal);
  return {
    schemaVersion: 1,
    workflow: "feature",
    graphDigest: currentDigest,
    status: "ready",
    completedNodes: ["scout", "plan", "approve-plan"],
    approvedGate: { id: "approve-plan", approval: "user", approved: true },
    checkpoint: reference,
    approval,
    workerPlan: {
      node: "implement",
      maxConcurrency: implement.fanOut,
      tasks,
      firstWave,
      projectSnapshotRequired: true,
      workersStarted: false,
    },
  };
}
