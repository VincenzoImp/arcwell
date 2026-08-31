import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { runFeatureWorkerCommand } from "../src/run-feature-worker-cli.js";
import type { RunIo } from "../src/run-cli.js";
import { PiFeatureLedger } from "../src/workflows/feature-ledger.js";
import { prepareFeatureWorkflow } from "../src/workflows/feature-preparation.js";
import { resumeFeatureWorkflow } from "../src/workflows/feature-resume.js";
import type { FeatureWorkerAgent } from "../src/workflows/feature-worker.js";
import type { PlanAgents } from "../src/workflows/plan.js";

function capture(): { io: RunIo; stdout: () => string; stderr: () => string } {
  let out = ""; let err = "";
  return { io: { stdout: (text) => { out += text; }, stderr: (text) => { err += text; } }, stdout: () => out, stderr: () => err };
}

const agents: PlanAgents = {
  async scout() { return { summary: "project", files: [{ path: "src/main.ts", relevance: "entry" }], risks: [] }; },
  async planner(input) {
    return { goal: input.goal, steps: [{ id: "task", needs: [], description: "Add task", files: ["src/task.ts"], verification: "npm test" }], risks: [] };
  },
};

const worker: FeatureWorkerAgent = {
  async execute(input) {
    writeFileSync(join(input.cwd, "src", "task.ts"), "export const task = true;\n");
    return { summary: "Added the approved task", verificationNotes: ["Verification remains deferred"] };
  },
};

test("worker CLI executes one approved root task without integrating it", async () => {
  const root = mkdtempSync(join(process.cwd(), ".tmp-tests", "worker-cli-"));
  try {
    const project = join(root, "project"); mkdirSync(join(project, "src"), { recursive: true });
    writeFileSync(join(project, "src", "main.ts"), "export const main = true;\n");
    const ledger = new PiFeatureLedger(join(root, "sessions"));
    const checkpoint = await prepareFeatureWorkflow({ goal: "worker cli", cwd: project }, agents);
    const reference = await ledger.saveCheckpoint(project, checkpoint);
    const resumed = await resumeFeatureWorkflow({ cwd: project, ...reference, approvePlan: true }, ledger);
    const output = capture();
    const code = await runFeatureWorkerCommand([
      "--session", reference.sessionId,
      "--checkpoint", reference.entryId,
      "--checkpoint-digest", reference.digest,
      "--approval", resumed.approval.id,
      "--task", "task",
      "--cwd", project,
      "--json",
    ], output.io, worker, ledger, undefined, join(root, "workspaces"));
    assert.equal(code, 0);
    assert.equal((JSON.parse(output.stdout()) as { status: string }).status, "succeeded");
    assert.match(output.stderr(), /isolated worker.*started/i);
    assert.equal(output.stdout().includes(root), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
