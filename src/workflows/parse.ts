import {
  verificationChecks,
  workflowBackends,
  workflowRoles,
  workflowWorkspaces,
  type AgentWorkflowNode,
  type WorkflowGraph,
  type WorkflowNode,
} from "./types.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function rejectUnknown(path: string, value: Record<string, unknown>, allowed: readonly string[]): void {
  const key = Object.keys(value).find((candidate) => !allowed.includes(candidate));
  if (key) throw new Error(`${path}.${key}: unknown property`);
}

function text(path: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${path}: expected a non-empty string`);
  return value;
}

function integer(path: string, value: unknown, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${path}: expected an integer from ${min} to ${max}`);
  }
  return value as number;
}

function member<T extends string>(path: string, value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${path}: expected one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function stringList(path: string, value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error(`${path}: expected an array`);
  const result = value.map((entry, index) => text(`${path}[${index}]`, entry));
  if (new Set(result).size !== result.length) throw new Error(`${path}: duplicate values are not allowed`);
  return result;
}

function parseNode(value: unknown, index: number, maxConcurrency: number): WorkflowNode {
  const path = `nodes[${index}]`;
  if (!isRecord(value)) throw new Error(`${path}: expected an object`);
  const kind = member(`${path}.kind`, value.kind, ["agent", "gate", "verify"] as const);
  const common = {
    id: text(`${path}.id`, value.id),
    kind,
    needs: stringList(`${path}.needs`, value.needs),
    inputs: stringList(`${path}.inputs`, value.inputs),
    outputs: stringList(`${path}.outputs`, value.outputs),
    objective: text(`${path}.objective`, value.objective),
    retries: integer(`${path}.retries`, value.retries, 0, 2),
  };
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(common.id)) throw new Error(`${path}.id: expected a portable kebab-case id`);

  if (kind === "agent") {
    rejectUnknown(path, value, ["id", "kind", "needs", "inputs", "outputs", "objective", "retries", "role", "access", "workspace", "workspaceSource", "backend", "fanOut"]);
    const node: AgentWorkflowNode = {
      ...common,
      kind,
      role: member(`${path}.role`, value.role, workflowRoles),
      access: member(`${path}.access`, value.access, ["read", "write"] as const),
      workspace: member(`${path}.workspace`, value.workspace, workflowWorkspaces),
      ...(value.workspaceSource === undefined ? {} : { workspaceSource: text(`${path}.workspaceSource`, value.workspaceSource) }),
      backend: member(`${path}.backend`, value.backend, workflowBackends),
      fanOut: integer(`${path}.fanOut`, value.fanOut, 1, maxConcurrency),
    };
    if (node.access === "write" && node.workspace !== "isolated") {
      throw new Error(`${path} (${node.id}): write agents require an isolated workspace`);
    }
    if (node.workspace === "shared" && node.workspaceSource !== undefined) {
      throw new Error(`${path}.workspaceSource: shared workspaces cannot consume a candidate workspace`);
    }
    if (node.access === "read" && node.workspace === "isolated" && node.workspaceSource === undefined) {
      throw new Error(`${path}.workspaceSource: isolated read agents require a source artifact`);
    }
    if (node.fanOut > 1 && node.role !== "worker") throw new Error(`${path}.fanOut: only worker nodes may fan out`);
    return node;
  }
  if (kind === "gate") {
    rejectUnknown(path, value, ["id", "kind", "needs", "inputs", "outputs", "objective", "retries", "approval"]);
    if (common.retries !== 0) throw new Error(`${path}.retries: gates cannot retry`);
    return { ...common, kind, approval: member(`${path}.approval`, value.approval, ["user"] as const) };
  }

  rejectUnknown(path, value, ["id", "kind", "needs", "inputs", "outputs", "objective", "retries", "checks", "workspace", "workspaceSource"]);
  const parsedChecks = stringList(`${path}.checks`, value.checks).map((entry, checkIndex) =>
    member(`${path}.checks[${checkIndex}]`, entry, verificationChecks));
  if (parsedChecks.length === 0) throw new Error(`${path}.checks: expected at least one check`);
  return {
    ...common,
    kind,
    checks: parsedChecks,
    workspace: member(`${path}.workspace`, value.workspace, ["isolated"] as const),
    workspaceSource: text(`${path}.workspaceSource`, value.workspaceSource),
  };
}

function assertAcyclic(nodes: WorkflowNode[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`workflow cycle detected at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.needs ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of nodes) visit(node.id);
}

function validateArtifactFlow(nodes: WorkflowNode[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const producers = new Map<string, string>();
  for (const [index, node] of nodes.entries()) {
    for (const artifact of node.outputs) {
      if (!/^[a-z][a-z0-9-]{0,62}$/.test(artifact)) throw new Error(`nodes[${index}].outputs: invalid artifact ${artifact}`);
      const previous = producers.get(artifact);
      if (previous) throw new Error(`nodes[${index}].outputs: artifact ${artifact} already produced by ${previous}`);
      producers.set(artifact, node.id);
    }
  }
  const isAncestor = (candidate: string, node: WorkflowNode, seen = new Set<string>()): boolean => {
    if (node.needs.includes(candidate)) return true;
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return node.needs.some((dependency) => {
      const parent = byId.get(dependency);
      return parent ? isAncestor(candidate, parent, new Set(seen)) : false;
    });
  };
  for (const [index, node] of nodes.entries()) {
    for (const artifact of node.inputs) {
      const producer = producers.get(artifact);
      if (!producer) throw new Error(`nodes[${index}].inputs: unknown artifact ${artifact}`);
      if (!isAncestor(producer, node)) throw new Error(`nodes[${index}].inputs: artifact ${artifact} is not produced by a dependency`);
    }
    if ("workspaceSource" in node && node.workspaceSource !== undefined && !node.inputs.includes(node.workspaceSource)) {
      throw new Error(`nodes[${index}].workspaceSource: ${node.workspaceSource} must also be declared as an input`);
    }
  }
}

export function parseWorkflowGraph(value: unknown): WorkflowGraph {
  if (!isRecord(value)) throw new Error("workflow: expected an object");
  rejectUnknown("workflow", value, ["schemaVersion", "name", "description", "maxConcurrency", "nodes"]);
  if (value.schemaVersion !== 1) throw new Error("schemaVersion: expected 1");
  const maxConcurrency = integer("maxConcurrency", value.maxConcurrency, 1, 8);
  if (!Array.isArray(value.nodes) || value.nodes.length === 0 || value.nodes.length > 32) {
    throw new Error("nodes: expected from 1 to 32 nodes");
  }
  const nodes = value.nodes.map((node, index) => parseNode(node, index, maxConcurrency));
  const ids = new Set<string>();
  for (const [index, node] of nodes.entries()) {
    if (ids.has(node.id)) throw new Error(`nodes[${index}].id: duplicate ${node.id}`);
    ids.add(node.id);
  }
  for (const [index, node] of nodes.entries()) {
    for (const dependency of node.needs) {
      if (!ids.has(dependency)) throw new Error(`nodes[${index}].needs: unknown node ${dependency}`);
      if (dependency === node.id) throw new Error(`workflow cycle detected at ${node.id}`);
    }
  }
  assertAcyclic(nodes);
  validateArtifactFlow(nodes);
  const name = text("name", value.name);
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(name)) throw new Error("name: expected a portable kebab-case name");
  return { schemaVersion: 1, name, description: text("description", value.description), maxConcurrency, nodes };
}
