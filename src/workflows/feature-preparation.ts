import { createHash } from "node:crypto";

import { featureWorkflow } from "./curated.js";
import { parseWorkflowGraph, planWorkflowGraph } from "./graph.js";
import {
  runPlanWorkflow,
  type PlanAgents,
  type PlanArtifact,
  type PlanRunEvent,
  type ScoutArtifact,
} from "./plan.js";

export interface FeaturePreparationResult {
  schemaVersion: 1;
  workflow: "feature";
  graphDigest: string;
  status: "blocked" | "failed" | "aborted";
  completedNodes: Array<"scout" | "plan">;
  currentGate?: { id: "approve-plan"; approval: "user"; approved: false };
  artifacts: {
    "project-map"?: ScoutArtifact;
    "implementation-plan"?: PlanArtifact;
    "task-partitions"?: PlanArtifact["steps"];
  };
  remainingWaves: Array<{ index: number; nodes: string[]; agents: number }>;
  error?: { node: "scout" | "plan"; code: string; message: string };
}

function graphContract() {
  const plan = planWorkflowGraph(parseWorkflowGraph(featureWorkflow));
  return { plan, digest: createHash("sha256").update(JSON.stringify(plan)).digest("hex") };
}

export function featureGraphDigest(): string {
  return graphContract().digest;
}

export async function prepareFeatureWorkflow(
  input: { goal: string; cwd: string; signal?: AbortSignal },
  agents: PlanAgents,
  onEvent: (event: PlanRunEvent) => void = () => {},
): Promise<FeaturePreparationResult> {
  const contract = graphContract();
  const run = await runPlanWorkflow(input, agents, onEvent);
  const completedNodes: Array<"scout" | "plan"> = [];
  if (run.artifacts.scout) completedNodes.push("scout");
  if (run.artifacts.plan) completedNodes.push("plan");
  const completed = new Set<string>(completedNodes);
  const remainingWaves = contract.plan.waves
    .filter((wave) => wave.nodes.some((node) => !completed.has(node)))
    .map((wave) => ({ ...wave, nodes: [...wave.nodes] }));
  const artifacts: FeaturePreparationResult["artifacts"] = {};
  if (run.artifacts.scout) artifacts["project-map"] = run.artifacts.scout;
  if (run.artifacts.plan) {
    artifacts["implementation-plan"] = run.artifacts.plan;
    artifacts["task-partitions"] = run.artifacts.plan.steps;
  }

  if (run.status !== "succeeded") {
    return {
      schemaVersion: 1,
      workflow: "feature",
      graphDigest: contract.digest,
      status: run.status,
      completedNodes,
      artifacts,
      remainingWaves,
      ...(run.error ? {
        error: {
          ...run.error,
          node: run.error.node === "planner" ? "plan" as const : "scout" as const,
        },
      } : {}),
    };
  }
  return {
    schemaVersion: 1,
    workflow: "feature",
    graphDigest: contract.digest,
    status: "blocked",
    completedNodes,
    currentGate: { id: "approve-plan", approval: "user", approved: false },
    artifacts,
    remainingWaves,
  };
}
