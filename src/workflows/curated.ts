import { compareText } from "../order.js";
import type { WorkflowGraph } from "./graph.js";

export const featureWorkflow: WorkflowGraph = {
  schemaVersion: 1,
  name: "feature",
  description: "Plan, approve, implement in isolated parallel workspaces, review, verify, and accept a feature.",
  maxConcurrency: 6,
  nodes: [
    {
      id: "scout",
      kind: "agent",
      needs: [],
      inputs: [],
      outputs: ["project-map"],
      objective: "Map the relevant project surface, constraints, and risks.",
      retries: 1,
      role: "scout",
      access: "read",
      workspace: "shared",
      backend: "subagent",
      fanOut: 1,
    },
    {
      id: "plan",
      kind: "agent",
      needs: ["scout"],
      inputs: ["project-map"],
      outputs: ["implementation-plan", "task-partitions"],
      objective: "Produce a dependency-aware implementation plan and partition independent tasks.",
      retries: 1,
      role: "planner",
      access: "read",
      workspace: "shared",
      backend: "subagent",
      fanOut: 1,
    },
    {
      id: "approve-plan",
      kind: "gate",
      needs: ["plan"],
      inputs: ["implementation-plan", "task-partitions"],
      outputs: ["approved-plan", "approved-task-partitions"],
      objective: "Require the user to approve the plan and any declared side effects.",
      retries: 0,
      approval: "user",
    },
    {
      id: "implement",
      kind: "agent",
      needs: ["approve-plan"],
      inputs: ["approved-plan", "approved-task-partitions"],
      outputs: ["worker-changesets"],
      objective: "Execute independent plan tasks in one isolated workspace per fan-out agent with tests first.",
      retries: 1,
      role: "worker",
      access: "write",
      workspace: "isolated",
      backend: "subagent",
      fanOut: 6,
    },
    {
      id: "integrate",
      kind: "agent",
      needs: ["implement"],
      inputs: ["worker-changesets"],
      outputs: ["candidate"],
      objective: "Integrate successful worker artifacts into one isolated candidate workspace.",
      retries: 1,
      role: "worker",
      access: "write",
      workspace: "isolated",
      backend: "subagent",
      fanOut: 1,
    },
    {
      id: "review",
      kind: "agent",
      needs: ["integrate"],
      inputs: ["candidate"],
      outputs: ["review-report"],
      objective: "Review integrated changes and reject findings without concrete failure scenarios.",
      retries: 1,
      role: "reviewer",
      access: "read",
      workspace: "isolated",
      workspaceSource: "candidate",
      backend: "subagent",
      fanOut: 1,
    },
    {
      id: "verify",
      kind: "verify",
      needs: ["review"],
      inputs: ["candidate", "review-report"],
      outputs: ["verification-evidence"],
      objective: "Run declared tests, diagnostics, diff review, and secret scanning.",
      retries: 1,
      checks: ["tests", "diagnostics", "diff-review", "secret-scan"],
      workspace: "isolated",
      workspaceSource: "candidate",
    },
    {
      id: "accept",
      kind: "gate",
      needs: ["verify"],
      inputs: ["verification-evidence"],
      outputs: ["accepted-feature"],
      objective: "Present evidence, unresolved assumptions, and side effects for final user acceptance.",
      retries: 0,
      approval: "user",
    },
  ],
};

const curated = [featureWorkflow];

export function listCuratedWorkflows(): WorkflowGraph[] {
  return curated
    .map((workflow) => structuredClone(workflow))
    .sort((left, right) => compareText(left.name, right.name));
}

export function curatedWorkflow(name: string): WorkflowGraph {
  const workflow = curated.find((candidate) => candidate.name === name);
  if (!workflow) throw new Error(`unknown curated workflow: ${name}`);
  return structuredClone(workflow);
}
