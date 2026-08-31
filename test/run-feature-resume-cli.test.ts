import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { runFeatureCommand } from "../src/run-feature-cli.js";
import { runFeatureResumeCommand } from "../src/run-feature-resume-cli.js";
import type { RunIo } from "../src/run-cli.js";
import { PiFeatureLedger } from "../src/workflows/feature-ledger.js";
import type { PlanAgents } from "../src/workflows/plan.js";

const agents: PlanAgents = {
  async scout() {
    return { summary: "project", files: [{ path: "src/cli.ts", relevance: "entry" }], risks: [] };
  },
  async planner(input) {
    return {
      goal: input.goal,
      steps: [{ id: "implement", needs: [], description: "Implement", files: ["src/cli.ts"], verification: "npm test" }],
      risks: [],
    };
  },
};

function capture(): { io: RunIo; stdout: () => string; stderr: () => string } {
  let out = "";
  let err = "";
  return {
    io: { stdout: (text) => { out += text; }, stderr: (text) => { err += text; } },
    stdout: () => out,
    stderr: () => err,
  };
}

test("run feature persist emits portable Pi session references and resume preview", async () => {
  const root = mkdtempSync(join(process.cwd(), ".tmp-tests", "resume-cli-"));
  try {
    const ledger = new PiFeatureLedger(join(root, "sessions"));
    const preparation = capture();
    const prepareCode = await runFeatureCommand(
      ["--goal", "Prepare", "--cwd", root, "--persist", "--json"],
      preparation.io,
      agents,
      undefined,
      ledger,
    );
    const prepared = JSON.parse(preparation.stdout()) as {
      status: string;
      ledger: { sessionId: string; checkpointEntryId: string; checkpointDigest: string };
    };
    assert.equal(prepareCode, 0);
    assert.equal(prepared.status, "blocked");
    assert.match(prepared.ledger.sessionId, /^[0-9a-f-]{36}$/);
    assert.equal(preparation.stdout().includes(root), false);

    const resumed = capture();
    const resumeCode = await runFeatureResumeCommand([
      "--session", prepared.ledger.sessionId,
      "--checkpoint", prepared.ledger.checkpointEntryId,
      "--checkpoint-digest", prepared.ledger.checkpointDigest,
      "--cwd", root,
      "--approve-plan",
      "--json",
    ], resumed.io, ledger);
    const result = JSON.parse(resumed.stdout()) as { status: string; workerPlan: { firstWave: string[] } };
    assert.equal(resumeCode, 0);
    assert.equal(result.status, "ready");
    assert.deepEqual(result.workerPlan.firstWave, ["implement"]);
    assert.equal(resumed.stdout().includes(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resume CLI requires explicit approval and an existing project-bound session", async () => {
  const root = mkdtempSync(join(process.cwd(), ".tmp-tests", "resume-cli-invalid-"));
  try {
    const ledger = new PiFeatureLedger(join(root, "sessions"));
    const missingApproval = capture();
    assert.equal(await runFeatureResumeCommand([
      "--session", "00000000-0000-4000-8000-000000000000",
      "--checkpoint", "deadbeef",
      "--checkpoint-digest", "0".repeat(64),
      "--cwd", root,
    ], missingApproval.io, ledger), 2);
    assert.match(missingApproval.stderr(), /--approve-plan is required/);

    const uppercase = capture();
    assert.equal(await runFeatureResumeCommand([
      "--session", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      "--checkpoint", "DEADBEEF",
      "--checkpoint-digest", "0".repeat(64),
      "--cwd", root,
      "--approve-plan",
    ], uppercase.io, ledger), 2);
    assert.match(uppercase.stderr(), /Pi session UUID/);

    const missingSession = capture();
    assert.equal(await runFeatureResumeCommand([
      "--session", "00000000-0000-4000-8000-000000000000",
      "--checkpoint", "deadbeef",
      "--checkpoint-digest", "0".repeat(64),
      "--cwd", root,
      "--approve-plan",
      "--json",
    ], missingSession.io, ledger), 1);
    assert.match(missingSession.stderr(), /feature session was not found/);
    assert.equal(missingSession.stdout(), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
