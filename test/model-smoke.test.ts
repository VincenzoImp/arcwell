import assert from "node:assert/strict";
import test from "node:test";

import { createBoundedPlanAgents } from "../src/backends/pi-sdk-plan-agents.js";
import { createPiSdkSessionFactory } from "../src/backends/pi-sdk-session-factory.js";
import { prepareFeatureWorkflow } from "../src/workflows/feature-preparation.js";

test("configured Pi model prepares a feature and stops at the real approval gate", {
  skip: process.env.ARCWELL_REAL_MODEL_TEST !== "1" ? "set ARCWELL_REAL_MODEL_TEST=1 for the credential-consuming smoke test" : false,
  timeout: 300_000,
}, async () => {
  const result = await prepareFeatureWorkflow(
    {
      goal: "Identify one small, verifiable improvement to Arcwell",
      cwd: process.cwd(),
      signal: AbortSignal.timeout(285_000),
    },
    createBoundedPlanAgents(createPiSdkSessionFactory()),
  );
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.currentGate, { id: "approve-plan", approval: "user", approved: false });
  assert.ok(result.artifacts["project-map"]);
  assert.ok(result.artifacts["implementation-plan"]);
  assert.ok((result.artifacts["task-partitions"]?.length ?? 0) > 0);
});
