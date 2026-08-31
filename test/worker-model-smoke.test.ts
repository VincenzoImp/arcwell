import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createPiSdkSessionFactory } from "../src/backends/pi-sdk-session-factory.js";
import { createPiSdkWorkerAgent } from "../src/backends/pi-sdk-worker-agent.js";
import { PiFeatureLedger } from "../src/workflows/feature-ledger.js";
import { prepareFeatureWorkflow } from "../src/workflows/feature-preparation.js";
import { resumeFeatureWorkflow } from "../src/workflows/feature-resume.js";
import { runFeatureWorker } from "../src/workflows/feature-worker.js";
import type { PlanAgents } from "../src/workflows/plan.js";

const agents: PlanAgents = {
  async scout() {
    return { summary: "A tiny TypeScript project", files: [{ path: "src/input.ts", relevance: "style reference" }], risks: [] };
  },
  async planner(input) {
    return {
      goal: input.goal,
      steps: [{
        id: "add-generated",
        needs: [],
        description: "Create src/generated.ts exporting the string arcwell-worker",
        files: ["src/generated.ts"],
        verification: "Inspect the exported string",
      }],
      risks: [],
    };
  },
};

test("configured Pi model writes one approved file only in an isolated workspace", {
  skip: process.env.ARCWELL_REAL_MODEL_TEST !== "1" ? "set ARCWELL_REAL_MODEL_TEST=1 for the credential-consuming smoke test" : false,
  timeout: 300_000,
}, async () => {
  const root = mkdtempSync(join(process.cwd(), ".tmp-tests", "worker-model-"));
  try {
    const project = join(root, "project");
    mkdirSync(join(project, "src"), { recursive: true });
    writeFileSync(join(project, "src", "input.ts"), "export const input = 'arcwell';\n");
    const ledger = new PiFeatureLedger(join(root, "sessions"));
    const checkpoint = await prepareFeatureWorkflow({ goal: "add one generated module", cwd: project }, agents);
    const reference = await ledger.saveCheckpoint(project, checkpoint);
    const resumed = await resumeFeatureWorkflow({ cwd: project, ...reference, approvePlan: true }, ledger);
    const result = await runFeatureWorker({
      cwd: project,
      workspaceRoot: join(root, "workspaces"),
      ...reference,
      approvalId: resumed.approval.id,
      taskId: "add-generated",
      signal: AbortSignal.timeout(285_000),
    }, ledger, createPiSdkWorkerAgent(createPiSdkSessionFactory()));
    assert.equal(result.status, "succeeded");
    assert.deepEqual(result.changes.map((change) => change.path), ["src/generated.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
