import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { featureWorkflow, listCuratedWorkflows } from "../src/workflows/curated.js";
import { parseWorkflowGraph, planWorkflowGraph } from "../src/workflows/graph.js";

const here = dirname(fileURLToPath(import.meta.url));

test("curated feature workflow exposes bounded fan-out, review, verification, and user gates", () => {
  const graph = parseWorkflowGraph(featureWorkflow);
  const plan = planWorkflowGraph(graph);
  assert.equal(plan.name, "feature");
  assert.equal(plan.maxConcurrency, 6);
  assert.deepEqual(plan.waves.map((wave) => wave.nodes), [
    ["scout"],
    ["plan"],
    ["approve-plan"],
    ["implement"],
    ["integrate"],
    ["review"],
    ["verify"],
    ["accept"],
  ]);
  assert.equal(plan.maxAgents, 6);
  assert.deepEqual(plan.userGates, ["approve-plan", "accept"]);
  const approval = plan.nodes.find((node) => node.id === "approve-plan");
  assert.ok(approval && approval.kind === "gate");
  assert.deepEqual(approval.inputs, ["implementation-plan", "task-partitions"]);
  assert.deepEqual(approval.outputs, ["approved-plan", "approved-task-partitions"]);
  const implementation = plan.nodes.find((node) => node.id === "implement");
  assert.ok(implementation && implementation.kind === "agent");
  assert.equal(implementation.fanOut, 6);
  assert.equal(implementation.workspace, "isolated");
  assert.deepEqual(implementation.outputs, ["worker-changesets"]);
  const reviewer = plan.nodes.find((node) => node.id === "review");
  assert.ok(reviewer && reviewer.kind === "agent");
  assert.equal(reviewer.workspaceSource, "candidate");
  const verification = plan.nodes.find((node) => node.id === "verify");
  assert.ok(verification && verification.kind === "verify");
  assert.equal(verification.workspace, "isolated");
  assert.equal(verification.workspaceSource, "candidate");
  assert.deepEqual(verification.checks, ["tests", "diagnostics", "diff-review", "secret-scan"]);
});

test("graph validation rejects cycles, unknown dependencies, and unisolated writers", () => {
  const base = structuredClone(featureWorkflow);
  base.nodes[0]!.needs = ["verify"];
  assert.throws(() => parseWorkflowGraph(base), /cycle/);

  const unknown = structuredClone(featureWorkflow);
  unknown.nodes[1]!.needs = ["missing"];
  assert.throws(() => parseWorkflowGraph(unknown), /nodes\[1\]\.needs.*missing/);

  const unsafe = structuredClone(featureWorkflow);
  const implement = unsafe.nodes.find((node) => node.id === "implement");
  assert.ok(implement && implement.kind === "agent");
  implement.workspace = "shared";
  assert.throws(() => parseWorkflowGraph(unsafe), /implement.*isolated workspace/);

  const missingArtifact = structuredClone(featureWorkflow);
  const review = missingArtifact.nodes.find((node) => node.id === "review");
  assert.ok(review);
  review.inputs = ["missing-artifact"];
  assert.throws(() => parseWorkflowGraph(missingArtifact), /review.*unknown artifact|inputs.*unknown artifact/);

  const unsafeVerification = structuredClone(featureWorkflow) as unknown as { nodes: Array<Record<string, unknown>> };
  const verify = unsafeVerification.nodes.find((node) => node.id === "verify");
  assert.ok(verify);
  verify.workspace = "shared";
  assert.throws(() => parseWorkflowGraph(unsafeVerification), /workspace.*isolated/);
});

test("planner batches independent fan-out nodes within the concurrency budget", () => {
  const graph = structuredClone(featureWorkflow);
  graph.maxConcurrency = 8;
  graph.nodes = [
    { id: "a", kind: "agent", needs: [], inputs: [], outputs: ["a-out"], objective: "A", retries: 0, role: "worker", access: "read", workspace: "shared", backend: "subagent", fanOut: 2 },
    { id: "b", kind: "agent", needs: [], inputs: [], outputs: ["b-out"], objective: "B", retries: 0, role: "worker", access: "read", workspace: "shared", backend: "subagent", fanOut: 4 },
    { id: "c", kind: "agent", needs: [], inputs: [], outputs: ["c-out"], objective: "C", retries: 0, role: "worker", access: "read", workspace: "shared", backend: "subagent", fanOut: 4 },
    { id: "d", kind: "agent", needs: [], inputs: [], outputs: ["d-out"], objective: "D", retries: 0, role: "worker", access: "read", workspace: "shared", backend: "subagent", fanOut: 6 },
  ];
  const plan = planWorkflowGraph(parseWorkflowGraph(graph));
  assert.deepEqual(plan.waves.map((wave) => wave.nodes), [["a", "d"], ["b", "c"]]);
  assert.equal(plan.waves.every((wave) => wave.agents <= graph.maxConcurrency), true);

  graph.nodes = [
    { id: "a", kind: "agent", needs: [], inputs: [], outputs: ["a-out"], objective: "A", retries: 0, role: "worker", access: "read", workspace: "shared", backend: "subagent", fanOut: 4 },
    { id: "b", kind: "agent", needs: [], inputs: [], outputs: ["b-out"], objective: "B", retries: 0, role: "worker", access: "read", workspace: "shared", backend: "subagent", fanOut: 2 },
    { id: "c", kind: "agent", needs: [], inputs: [], outputs: ["c-out"], objective: "C", retries: 0, role: "worker", access: "read", workspace: "shared", backend: "subagent", fanOut: 2 },
    { id: "d", kind: "agent", needs: [], inputs: [], outputs: ["d-out"], objective: "D", retries: 0, role: "worker", access: "read", workspace: "shared", backend: "subagent", fanOut: 4 },
    { id: "e", kind: "agent", needs: [], inputs: [], outputs: ["e-out"], objective: "E", retries: 0, role: "worker", access: "read", workspace: "shared", backend: "subagent", fanOut: 6 },
    { id: "f", kind: "agent", needs: [], inputs: [], outputs: ["f-out"], objective: "F", retries: 0, role: "worker", access: "read", workspace: "shared", backend: "subagent", fanOut: 6 },
  ];
  const optimized = planWorkflowGraph(parseWorkflowGraph(graph));
  assert.deepEqual(optimized.waves.map((wave) => wave.nodes), [["a", "d"], ["b", "e"], ["c", "f"]]);
});

test("graph plan is deterministic when declaration order changes", () => {
  const graph = structuredClone(featureWorkflow);
  graph.nodes = graph.nodes.filter((node) => ["scout", "plan"].includes(node.id));
  const planNode = graph.nodes.find((node) => node.id === "plan");
  assert.ok(planNode);
  planNode.needs = [];
  planNode.inputs = [];
  const first = planWorkflowGraph(parseWorkflowGraph(graph));
  const reordered = structuredClone(graph);
  reordered.nodes.reverse();
  const second = planWorkflowGraph(parseWorkflowGraph(reordered));
  assert.deepEqual(first, second);
});

test("workflow CLI lists and explains curated workflows", () => {
  assert.deepEqual(listCuratedWorkflows().map((workflow) => workflow.name), ["feature"]);
  const cli = join(here, "..", "src", "cli.js");
  const listed = JSON.parse(execFileSync(process.execPath, [cli, "experimental", "workflows", "--json"], { encoding: "utf8" })) as Array<{ name: string }>;
  assert.deepEqual(listed.map((workflow) => workflow.name), ["feature"]);
  const human = execFileSync(process.execPath, [cli, "experimental", "workflow", "explain", "feature"], { encoding: "utf8" });
  assert.match(human, /^Experimental Arcwell workflow feature:/);
  const output = execFileSync(process.execPath, [cli, "experimental", "workflow", "explain", "feature", "--json"], { encoding: "utf8" });
  const parsed = JSON.parse(output) as { name: string; waves: unknown[]; maxAgents: number };
  assert.equal(parsed.name, "feature");
  assert.equal(parsed.waves.length, 8);
  assert.equal(parsed.maxAgents, 6);
});
