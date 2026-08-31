import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { PiFeatureLedger } from "../src/workflows/feature-ledger.js";
import { prepareFeatureWorkflow } from "../src/workflows/feature-preparation.js";
import { resumeFeatureWorkflow } from "../src/workflows/feature-resume.js";
import { runFeatureWorker, type FeatureWorkerAgent } from "../src/workflows/feature-worker.js";
import type { PlanAgents } from "../src/workflows/plan.js";

const agents: PlanAgents = {
  async scout() {
    return { summary: "project", files: [{ path: "src/cli.ts", relevance: "entry" }], risks: [] };
  },
  async planner(input) {
    return {
      goal: input.goal,
      steps: [
        { id: "foundation", needs: [], description: "Add foundation", files: ["src/foundation.ts"], verification: "npm test" },
        { id: "command", needs: ["foundation"], description: "Expose command", files: ["src/cli.ts"], verification: "npm test" },
      ],
      risks: [],
    };
  },
};

function setup() {
  const root = mkdtempSync(join(process.cwd(), ".tmp-tests", "feature-worker-"));
  mkdirSync(join(root, "project", "src"), { recursive: true });
  writeFileSync(join(root, "project", "src", "cli.ts"), "export const cli = true;\n");
  return {
    root,
    project: join(root, "project"),
    workspaces: join(root, "workspaces"),
    sessions: join(root, "sessions"),
  };
}

async function approved(root: ReturnType<typeof setup>) {
  const ledger = new PiFeatureLedger(root.sessions);
  const checkpoint = await prepareFeatureWorkflow({ goal: "implement one task", cwd: root.project }, agents);
  const reference = await ledger.saveCheckpoint(root.project, checkpoint);
  const resumed = await resumeFeatureWorkflow({ cwd: root.project, ...reference, approvePlan: true }, ledger);
  return { ledger, reference, approvalId: resumed.approval.id };
}

const foundationWorker: FeatureWorkerAgent = {
  async execute(input) {
    writeFileSync(join(input.cwd, "src", "foundation.ts"), "export const foundation = true;\n");
    return { summary: "Added the approved foundation file", verificationNotes: ["Verification is deferred to the candidate workspace"] };
  },
};

test("one approved task runs in isolation and persists a bounded changeset", async () => {
  const root = setup();
  try {
    const state = await approved(root);
    const result = await runFeatureWorker({
      cwd: root.project,
      workspaceRoot: root.workspaces,
      ...state.reference,
      approvalId: state.approvalId,
      taskId: "foundation",
    }, state.ledger, foundationWorker);

    assert.equal(result.status, "succeeded");
    assert.equal(result.taskId, "foundation");
    assert.equal(result.workersStarted, 1);
    assert.deepEqual(result.changes.map((change) => [change.path, change.status]), [["src/foundation.ts", "added"]]);
    assert.equal(existsSync(join(root.project, "src", "foundation.ts")), false);
    assert.equal(existsSync(join(root.workspaces, result.workspaceId, "src", "foundation.ts")), true);
    assert.equal(JSON.stringify(result).includes(root.root), false);

    const sessionName = readdirSync(root.sessions).find((name) => name.includes(state.reference.sessionId));
    assert.ok(sessionName);
    assert.match(readFileSync(join(root.sessions, sessionName), "utf8"), /arcwell\.feature\.worker-result\.v1/);
  } finally {
    rmSync(root.root, { recursive: true, force: true });
  }
});

test("unauthorized writes, drift, and abort fail before project mutation", async () => {
  const root = setup();
  try {
    const state = await approved(root);
    const unauthorized: FeatureWorkerAgent = {
      async execute(input) {
        writeFileSync(join(input.cwd, "src", "cli.ts"), "export const cli = false;\n");
        return { summary: "Changed an undeclared file", verificationNotes: [] };
      },
    };
    await assert.rejects(() => runFeatureWorker({
      cwd: root.project, workspaceRoot: root.workspaces, ...state.reference,
      approvalId: state.approvalId, taskId: "foundation",
    }, state.ledger, unauthorized), /outside the approved task files/);
    assert.equal(readFileSync(join(root.project, "src", "cli.ts"), "utf8"), "export const cli = true;\n");
    assert.deepEqual(existsSync(root.workspaces) ? readdirSync(root.workspaces) : [], []);

    writeFileSync(join(root.project, "src", "cli.ts"), "export const drift = true;\n");
    await assert.rejects(() => runFeatureWorker({
      cwd: root.project, workspaceRoot: root.workspaces, ...state.reference,
      approvalId: state.approvalId, taskId: "foundation",
    }, state.ledger, foundationWorker), /project snapshot has changed/);

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => runFeatureWorker({
      cwd: root.project, workspaceRoot: root.workspaces, ...state.reference,
      approvalId: state.approvalId, taskId: "foundation", signal: controller.signal,
    }, state.ledger, foundationWorker), /aborted/);
  } finally {
    rmSync(root.root, { recursive: true, force: true });
  }
});
