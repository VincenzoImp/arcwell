import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { runFeatureCommand } from "../src/run-feature-cli.js";
import type { RunIo } from "../src/run-cli.js";
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

test("run feature returns a portable blocked checkpoint", async () => {
  const root = mkdtempSync(join(process.cwd(), ".tmp-tests", "run-feature-"));
  try {
    const output = capture();
    const code = await runFeatureCommand(["--goal", "Prepare a feature", "--cwd", root, "--json"], output.io, agents);
    const result = JSON.parse(output.stdout()) as {
      status: string;
      currentGate: { id: string; approved: boolean };
      graphDigest: string;
    };
    assert.equal(code, 0);
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.currentGate, { id: "approve-plan", approval: "user", approved: false });
    assert.equal(result.graphDigest.length, 64);
    assert.match(output.stderr(), /scout.*planner/s);
    assert.equal(output.stdout().includes(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("run feature human output makes the no-write gate explicit", async () => {
  const output = capture();
  const code = await runFeatureCommand(["--goal", "Prepare", "--cwd", process.cwd()], output.io, agents);
  assert.equal(code, 0);
  assert.match(output.stdout(), /Stopped at user gate approve-plan/);
  assert.match(output.stdout(), /stopped before worker scheduling/i);
});
