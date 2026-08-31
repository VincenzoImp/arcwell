import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { PiFeatureLedger } from "../src/workflows/feature-ledger.js";
import { prepareFeatureWorkflow } from "../src/workflows/feature-preparation.js";
import { resumeFeatureWorkflow } from "../src/workflows/feature-resume.js";
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

function workspace() {
  const root = mkdtempSync(join(process.cwd(), ".tmp-tests", "feature-resume-"));
  const sessions = join(root, "sessions");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "cli.ts"), "export const cli = true;\n");
  return { root, sessions, ledger: new PiFeatureLedger(sessions) };
}

function readSession(sessions: string, sessionId: string): string {
  const name = readdirSync(sessions).find((candidate) => candidate.includes(sessionId));
  assert.ok(name, `missing session ${sessionId}`);
  return readFileSync(join(sessions, name), "utf8");
}

test("Pi custom entries persist and resume an approved feature checkpoint", async () => {
  const { root, sessions, ledger } = workspace();
  try {
    const checkpoint = await prepareFeatureWorkflow({ goal: "implement resume", cwd: root }, agents);
    assert.equal(checkpoint.status, "blocked");
    const saved = await ledger.saveCheckpoint(root, checkpoint);
    const result = await resumeFeatureWorkflow({
      cwd: root,
      sessionId: saved.sessionId,
      entryId: saved.entryId,
      digest: saved.digest,
      approvePlan: true,
    }, ledger);

    assert.equal(result.status, "ready");
    assert.equal(result.checkpoint.entryId, saved.entryId);
    assert.equal(result.approvedGate.id, "approve-plan");
    assert.equal(result.approvedGate.approved, true);
    assert.deepEqual(result.completedNodes, ["scout", "plan", "approve-plan"]);
    assert.equal(result.workerPlan.node, "implement");
    assert.equal(result.workerPlan.maxConcurrency, 6);
    assert.deepEqual(result.workerPlan.firstWave, ["foundation"]);
    assert.equal(result.workerPlan.tasks.every((task) => task.workspace === "isolated"), true);
    assert.equal(JSON.stringify(result).includes(root), false);

    const sessionFiles = readSession(sessions, saved.sessionId);
    assert.match(sessionFiles, /arcwell\.feature\.checkpoint\.v1/);
    assert.match(sessionFiles, /arcwell\.feature\.approval\.v1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resume is idempotent and rejects graph drift before recording approval", async () => {
  const { root, sessions, ledger } = workspace();
  try {
    const checkpoint = await prepareFeatureWorkflow({ goal: "implement resume", cwd: root }, agents);
    const saved = await ledger.saveCheckpoint(root, checkpoint);
    const first = await resumeFeatureWorkflow({ cwd: root, ...saved, approvePlan: true }, ledger);
    const second = await resumeFeatureWorkflow({ cwd: root, ...saved, approvePlan: true }, ledger);
    assert.equal(first.approval.id, second.approval.id);
    const approvalEntries = readSession(sessions, saved.sessionId)
      .trim().split("\n").map((line) => JSON.parse(line) as { customType?: string; data?: { approvalId?: string } })
      .filter((entry) => entry.customType === "arcwell.feature.approval.v1");
    assert.equal(approvalEntries.length, 1);

    const stale = structuredClone(checkpoint);
    stale.graphDigest = "0".repeat(64);
    const staleSaved = await ledger.saveCheckpoint(root, stale);
    await assert.rejects(
      () => resumeFeatureWorkflow({ cwd: root, ...staleSaved, approvePlan: true }, ledger),
      /workflow graph has changed/,
    );
    const staleLog = readSession(sessions, staleSaved.sessionId);
    assert.equal(staleLog.includes("arcwell.feature.approval.v1"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
