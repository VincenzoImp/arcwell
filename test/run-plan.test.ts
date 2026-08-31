import assert from "node:assert/strict";
import test from "node:test";

import { runPlanWorkflow, type PlanAgents, type ScoutArtifact } from "../src/workflows/plan.js";

const scoutArtifact: ScoutArtifact = {
  summary: "Small strict TypeScript CLI",
  files: [{ path: "src/cli.ts", relevance: "command boundary" }],
  risks: ["keep execution read-only"],
};

const planArtifact = {
  goal: "add project planning",
  steps: [{ id: "add-workflow", needs: [], description: "Add a bounded workflow", files: ["src/workflows/plan.ts"], verification: "npm test" }],
  risks: ["unbounded orchestration"],
};

test("fixed plan workflow passes structured scout output to planner", async () => {
  const calls: string[] = [];
  const events: string[] = [];
  const agents: PlanAgents = {
    async scout() {
      calls.push("scout");
      return scoutArtifact;
    },
    async planner(input) {
      calls.push("planner");
      assert.deepEqual(input.scout, scoutArtifact);
      return planArtifact;
    },
  };

  const result = await runPlanWorkflow(
    { goal: "add project planning", cwd: "." },
    agents,
    (event) => events.push(`${event.node}:${event.status}`),
  );

  assert.deepEqual(calls, ["scout", "planner"]);
  assert.deepEqual(events, ["scout:started", "scout:succeeded", "planner:started", "planner:succeeded"]);
  assert.deepEqual(result, {
    schemaVersion: 1,
    workflow: "plan",
    status: "succeeded",
    artifacts: { scout: scoutArtifact, plan: planArtifact },
  });
});

test("scout failure stops the workflow before planner", async () => {
  let plannerCalled = false;
  const agents: PlanAgents = {
    async scout() { throw new Error("repository unavailable"); },
    async planner() { plannerCalled = true; return planArtifact; },
  };
  const result = await runPlanWorkflow({ goal: "plan", cwd: "." }, agents);
  assert.equal(result.status, "failed");
  assert.equal(result.error?.node, "scout");
  assert.equal(plannerCalled, false);
});

test("abort is distinct from failure", async () => {
  const controller = new AbortController();
  controller.abort();
  const agents: PlanAgents = {
    async scout() { throw new Error("must not run"); },
    async planner() { return planArtifact; },
  };
  const result = await runPlanWorkflow({ goal: "plan", cwd: ".", signal: controller.signal }, agents);
  assert.equal(result.status, "aborted");
  assert.equal(result.error?.code, "aborted");
});

test("machine-specific paths in prose fail the portable artifact contract", async () => {
  const leakingScout: PlanAgents = {
    async scout() { return { ...scoutArtifact, summary: "repository at /Users/alice/private" }; },
    async planner() { return planArtifact; },
  };
  const scoutResult = await runPlanWorkflow({ goal: "plan", cwd: process.cwd() }, leakingScout);
  assert.equal(scoutResult.error?.code, "invalid_artifact");
  for (const summary of ["repository cache: /var/tmp/build", "cache=/var/tmp/build", "path=`/opt/project`", "root:[/srv/app]", "path:/var/tmp/build", "file:///etc/passwd", "path:D:\\work\\repo"]) {
    const genericPathResult = await runPlanWorkflow({ goal: "plan", cwd: process.cwd() }, {
      ...leakingScout,
      async scout() { return { ...scoutArtifact, summary }; },
    });
    assert.equal(genericPathResult.error?.code, "invalid_artifact");
  }
  const webUrlResult = await runPlanWorkflow({ goal: "plan", cwd: process.cwd() }, {
    ...leakingScout,
    async scout() { return { ...scoutArtifact, summary: "documentation at https://example.com/project/path" }; },
  });
  assert.equal(webUrlResult.status, "succeeded");

  const leakingPlan: PlanAgents = {
    async scout() { return scoutArtifact; },
    async planner() {
      return {
        ...planArtifact,
        steps: [{ ...planArtifact.steps[0]!, verification: `npm --prefix ${process.cwd()} test` }],
      };
    },
  };
  const planResult = await runPlanWorkflow({ goal: "plan", cwd: process.cwd() }, leakingPlan);
  assert.equal(planResult.error?.code, "invalid_artifact");
  const windowsPathResult = await runPlanWorkflow({ goal: "plan", cwd: process.cwd() }, {
    ...leakingPlan,
    async planner() {
      return { ...planArtifact, steps: [{ ...planArtifact.steps[0]!, verification: "npm --prefix D:\\work\\repo test" }] };
    },
  });
  assert.equal(windowsPathResult.error?.code, "invalid_artifact");
});

test("abort that arrives while planner resolves does not open a success path", async () => {
  const controller = new AbortController();
  const aborting: PlanAgents = {
    async scout() { return scoutArtifact; },
    async planner() {
      controller.abort();
      return planArtifact;
    },
  };
  const result = await runPlanWorkflow({ goal: "plan", cwd: ".", signal: controller.signal }, aborting);
  assert.equal(result.status, "aborted");
  assert.equal(result.error?.node, "planner");
  assert.equal(result.artifacts.plan, undefined);
});

test("abort from the final success event still blocks feature approval", async () => {
  const controller = new AbortController();
  const result = await runPlanWorkflow(
    { goal: "plan", cwd: ".", signal: controller.signal },
    {
      async scout() { return scoutArtifact; },
      async planner() { return planArtifact; },
    },
    (event) => { if (event.node === "planner" && event.status === "succeeded") controller.abort(); },
  );
  assert.equal(result.status, "aborted");
  assert.equal(result.artifacts.plan, undefined);
});

test("absolute and escaping artifact paths fail closed", async () => {
  const agents: PlanAgents = {
    async scout() { return { ...scoutArtifact, files: [{ path: "../secret", relevance: "bad" }] }; },
    async planner() { return planArtifact; },
  };
  const result = await runPlanWorkflow({ goal: "plan", cwd: "." }, agents);
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "invalid_artifact");

  const uncAgents: PlanAgents = {
    async scout() { return { ...scoutArtifact, files: [{ path: "\\\\server\\share\\secret", relevance: "bad" }] }; },
    async planner() { return planArtifact; },
  };
  const uncResult = await runPlanWorkflow({ goal: "plan", cwd: "." }, uncAgents);
  assert.equal(uncResult.error?.code, "invalid_artifact");

  const malformedAgents: PlanAgents = {
    async scout() {
      return { ...scoutArtifact, files: [{ path: undefined, relevance: "bad" }] } as unknown as ScoutArtifact;
    },
    async planner() { return planArtifact; },
  };
  const malformed = await runPlanWorkflow({ goal: "plan", cwd: "." }, malformedAgents);
  assert.equal(malformed.error?.code, "invalid_artifact");

  const driveAgents: PlanAgents = {
    async scout() { return { ...scoutArtifact, files: [{ path: "C:secret.txt", relevance: "bad" }] }; },
    async planner() { return planArtifact; },
  };
  const drive = await runPlanWorkflow({ goal: "plan", cwd: "." }, driveAgents);
  assert.equal(drive.error?.code, "invalid_artifact");

  for (const path of ["CON", "CONIN$", "CONOUT$", "src/file.ts:stream", "src/foo?.ts", "src/a*b.ts", "src\\file.ts", "nul\0file", "trailing. "]) {
    const reservedAgents: PlanAgents = {
      async scout() { return { ...scoutArtifact, files: [{ path, relevance: "bad" }] }; },
      async planner() { return planArtifact; },
    };
    const reserved = await runPlanWorkflow({ goal: "plan", cwd: "." }, reservedAgents);
    assert.equal(reserved.error?.code, "invalid_artifact");
  }

  const nullAgents: PlanAgents = {
    async scout() { return null as unknown as ScoutArtifact; },
    async planner() { return planArtifact; },
  };
  const nullResult = await runPlanWorkflow({ goal: "plan", cwd: "." }, nullAgents);
  assert.equal(nullResult.error?.code, "invalid_artifact");
});
