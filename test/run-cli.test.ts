import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { runPlanCommand, type RunIo } from "../src/run-cli.js";
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

test("run plan emits one structured JSON document and bounded progress", async () => {
  const root = mkdtempSync(join(process.cwd(), ".tmp-tests", "run-cli-"));
  try {
    const output = capture();
    const code = await runPlanCommand(["--goal", "Plan the next vertical", "--cwd", root, "--json"], output.io, agents);
    assert.equal(code, 0);
    assert.equal(JSON.parse(output.stdout()).status, "succeeded");
    assert.equal(output.stdout().trim().split("\n")[0], "{");
    assert.match(output.stderr(), /scout.*planner/s);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("run plan rejects empty goals and invalid directories before agents run", async () => {
  let called = false;
  const never: PlanAgents = {
    async scout() { called = true; return agents.scout({ goal: "x", cwd: "." }); },
    planner: agents.planner,
  };
  const output = capture();
  assert.equal(await runPlanCommand(["--goal", "  ", "--cwd", "."], output.io, never), 2);
  assert.equal(await runPlanCommand(["--goal", "x", "--cwd", "/definitely/missing/arcwell"], output.io, never), 2);
  assert.equal(called, false);
});
