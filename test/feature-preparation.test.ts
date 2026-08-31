import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { featureWorkflow } from "../src/workflows/curated.js";
import { prepareFeatureWorkflow } from "../src/workflows/feature-preparation.js";
import { parseWorkflowGraph, planWorkflowGraph } from "../src/workflows/graph.js";
import type { PlanAgents } from "../src/workflows/plan.js";

const agents: PlanAgents = {
  async scout() {
    return {
      summary: "Arcwell is a strict TypeScript CLI",
      files: [{ path: "src/cli.ts", relevance: "command entrypoint" }],
      risks: ["keep the gate explicit"],
    };
  },
  async planner(input) {
    return {
      goal: input.goal,
      steps: [
        { id: "prepare", needs: [], description: "Add the gated feature preparation", files: ["src/workflows/feature-preparation.ts"], verification: "npm test" },
        { id: "expose-command", needs: ["prepare"], description: "Expose the command", files: ["src/cli.ts"], verification: "npm test" },
      ],
      risks: ["must not execute workers before approval"],
    };
  },
};

test("feature preparation executes read-only nodes then blocks at approval", async () => {
  const first = await prepareFeatureWorkflow({ goal: "prepare a feature", cwd: "." }, agents);
  const second = await prepareFeatureWorkflow({ goal: "prepare a feature", cwd: "." }, agents);

  assert.equal(first.status, "blocked");
  const expectedDigest = createHash("sha256")
    .update(JSON.stringify(planWorkflowGraph(parseWorkflowGraph(featureWorkflow))))
    .digest("hex");
  assert.equal(first.graphDigest, expectedDigest);
  assert.equal(first.graphDigest, second.graphDigest);
  assert.deepEqual(first.completedNodes, ["scout", "plan"]);
  assert.deepEqual(first.currentGate, { id: "approve-plan", approval: "user", approved: false });
  assert.equal(first.artifacts["task-partitions"]?.length, 2);
  assert.ok(first.artifacts["project-map"]);
  assert.ok(first.artifacts["implementation-plan"]);
  assert.equal(first.remainingWaves[0]?.nodes.includes("approve-plan"), true);
  assert.equal(JSON.stringify(first).includes(process.cwd()), false);
});

test("feature preparation propagates failure without opening the gate", async () => {
  const failing: PlanAgents = {
    async scout() { throw new Error("failed"); },
    planner: agents.planner,
  };
  const result = await prepareFeatureWorkflow({ goal: "prepare", cwd: "." }, failing);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.completedNodes, []);
  assert.equal(result.currentGate, undefined);
  assert.equal(result.artifacts["implementation-plan"], undefined);

  const plannerFailure: PlanAgents = {
    scout: agents.scout,
    async planner() { throw new Error("failed"); },
  };
  const plannerResult = await prepareFeatureWorkflow({ goal: "prepare", cwd: "." }, plannerFailure);
  assert.equal(plannerResult.error?.node, "plan");
  assert.deepEqual(plannerResult.completedNodes, ["scout"]);
  assert.equal(plannerResult.remainingWaves.some((wave) => wave.nodes.includes("plan")), true);
});
