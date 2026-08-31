import assert from "node:assert/strict";
import test from "node:test";

import { runPlanWorkflow } from "../src/workflows/plan.js";

test("implementation tasks must declare at least one writable file", async () => {
  const result = await runPlanWorkflow({ goal: "plan", cwd: process.cwd() }, {
    async scout() { return { summary: "project", files: [], risks: [] }; },
    async planner() {
      return {
        goal: "plan",
        steps: [{ id: "empty", needs: [], description: "Do work", files: [], verification: "npm test" }],
        risks: [],
      };
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "invalid_artifact");
});

test("implementation plans are bounded before checkpoint persistence", async () => {
  const result = await runPlanWorkflow({ goal: "plan", cwd: process.cwd() }, {
    async scout() { return { summary: "project", files: [], risks: [] }; },
    async planner() {
      return {
        goal: "plan",
        steps: Array.from({ length: 33 }, (_, index) => ({
          id: `task-${index}`,
          needs: [],
          description: "Do bounded work",
          files: [`src/task-${index}.ts`],
          verification: "npm test",
        })),
        risks: [],
      };
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "invalid_artifact");
});

test("combined scout and plan files fit the snapshot budget", async () => {
  const result = await runPlanWorkflow({ goal: "plan", cwd: process.cwd() }, {
    async scout() {
      return {
        summary: "project",
        files: Array.from({ length: 256 }, (_, index) => ({ path: `src/scout-${index}.ts`, relevance: "relevant" })),
        risks: [],
      };
    },
    async planner() {
      return {
        goal: "plan",
        steps: [{ id: "task", needs: [], description: "Do work", files: ["src/distinct.ts"], verification: "npm test" }],
        risks: [],
      };
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "invalid_artifact");
});

test("implementation artifacts reject undeclared serialized fields", async () => {
  const result = await runPlanWorkflow({ goal: "plan", cwd: process.cwd() }, {
    async scout() { return { summary: "project", files: [], risks: [] }; },
    async planner() {
      return {
        goal: "plan",
        steps: [{ id: "task", needs: [], description: "Do work", files: ["src/task.ts"], verification: "npm test", padding: "x" }],
        risks: [],
      };
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "invalid_artifact");
});
