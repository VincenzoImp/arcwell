export const workflowRoles = ["scout", "planner", "worker", "reviewer"] as const;
export const workflowBackends = ["subagent", "herdr"] as const;
export const workflowWorkspaces = ["shared", "isolated"] as const;
export const verificationChecks = ["tests", "diagnostics", "diff-review", "secret-scan"] as const;

export type WorkflowRole = (typeof workflowRoles)[number];
export type WorkflowBackend = (typeof workflowBackends)[number];
export type WorkflowWorkspace = (typeof workflowWorkspaces)[number];
export type VerificationCheck = (typeof verificationChecks)[number];

export interface WorkflowNodeBase {
  id: string;
  needs: string[];
  inputs: string[];
  outputs: string[];
  objective: string;
  retries: number;
}

export interface AgentWorkflowNode extends WorkflowNodeBase {
  kind: "agent";
  role: WorkflowRole;
  access: "read" | "write";
  workspace: WorkflowWorkspace;
  workspaceSource?: string;
  backend: WorkflowBackend;
  fanOut: number;
}

export interface GateWorkflowNode extends WorkflowNodeBase {
  kind: "gate";
  approval: "user";
}

export interface VerifyWorkflowNode extends WorkflowNodeBase {
  kind: "verify";
  checks: VerificationCheck[];
  workspace: "isolated";
  workspaceSource: string;
}

export type WorkflowNode = AgentWorkflowNode | GateWorkflowNode | VerifyWorkflowNode;

export interface WorkflowGraph {
  schemaVersion: 1;
  name: string;
  description: string;
  maxConcurrency: number;
  nodes: WorkflowNode[];
}

export interface WorkflowPlan {
  schemaVersion: 1;
  name: string;
  description: string;
  maxConcurrency: number;
  maxAgents: number;
  nodes: WorkflowNode[];
  waves: Array<{ index: number; nodes: string[]; agents: number }>;
  userGates: string[];
}
