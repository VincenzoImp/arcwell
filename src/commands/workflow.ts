import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { curatedWorkflow, listCuratedWorkflows } from "../workflows/curated.js";
import { parseWorkflowGraph, planWorkflowGraph, type WorkflowPlan } from "../workflows/graph.js";
import { workflowSchema } from "../workflows/schema.js";
import type { CommandIo } from "./types.js";

function renderPlan(plan: WorkflowPlan, json: boolean, io: CommandIo): void {
  if (json) {
    io.stdout(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  io.stdout(`Experimental Arcwell workflow ${plan.name}: max ${plan.maxAgents} agents\n`);
  for (const wave of plan.waves) io.stdout(`${wave.index + 1}. ${wave.nodes.join(", ")} [${wave.agents} agents]\n`);
  if (plan.userGates.length > 0) io.stdout(`User gates: ${plan.userGates.join(", ")}\n`);
}

function loadGraph(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`workflow: could not read valid JSON (${error instanceof Error ? error.message : error})`);
  }
}

export function handleWorkflowCommand(argv: string[], io: CommandIo): boolean {
  const command = argv[0];
  if (command === "workflows") {
    const parsed = parseArgs({
      args: argv.slice(1),
      allowPositionals: false,
      strict: true,
      options: { json: { type: "boolean", default: false } },
    });
    const workflows = listCuratedWorkflows().map((workflow) => ({
      name: workflow.name,
      description: workflow.description,
      nodes: workflow.nodes.length,
      maxConcurrency: workflow.maxConcurrency,
    }));
    if (parsed.values.json) io.stdout(`${JSON.stringify(workflows, null, 2)}\n`);
    else for (const workflow of workflows) io.stdout(`${workflow.name} [${workflow.nodes} nodes, max ${workflow.maxConcurrency} agents] — ${workflow.description}\n`);
    return true;
  }
  if (command !== "workflow") return false;

  const action = argv[1];
  if (action === "schema") {
    if (argv.length !== 2) throw new Error("workflow schema: no arguments are accepted");
    io.stdout(`${JSON.stringify(workflowSchema, null, 2)}\n`);
    return true;
  }
  if (action === "explain") {
    if (!argv[2]) throw new Error("workflow: expected explain <name>");
    const parsed = parseArgs({
      args: argv.slice(3),
      allowPositionals: false,
      strict: true,
      options: { json: { type: "boolean", default: false } },
    });
    renderPlan(planWorkflowGraph(parseWorkflowGraph(curatedWorkflow(argv[2]))), parsed.values.json, io);
    return true;
  }
  if (action === "validate") {
    const parsed = parseArgs({
      args: argv.slice(2),
      allowPositionals: false,
      strict: true,
      options: {
        file: { type: "string" },
        json: { type: "boolean", default: false },
      },
    });
    if (!parsed.values.file) throw new Error("workflow validate: --file <path> is required");
    renderPlan(planWorkflowGraph(parseWorkflowGraph(loadGraph(parsed.values.file))), parsed.values.json, io);
    return true;
  }
  throw new Error("workflow: expected explain <name>, validate --file <path>, or schema");
}
