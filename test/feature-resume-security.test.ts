import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import { PiFeatureLedger } from "../src/workflows/feature-ledger.js";
import { assertApprovalAppendBudget } from "../src/workflows/pi-session-files.js";
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

test("resume binds approval to the emitted entry and checkpoint contents", async () => {
  const { root, sessions, ledger } = workspace();
  try {
    const checkpoint = await prepareFeatureWorkflow({ goal: "implement resume", cwd: root }, agents);
    const saved = await ledger.saveCheckpoint(root, checkpoint);
    const listed = await SessionManager.list(root, sessions);
    const manager = SessionManager.open(listed[0]!.path, sessions);
    const injected = structuredClone(checkpoint);
    injected.artifacts["implementation-plan"]!.steps[0]!.id = "injected";
    injected.artifacts["implementation-plan"]!.steps[1]!.needs = ["injected"];
    injected.artifacts["task-partitions"]![0]!.id = "injected";
    injected.artifacts["task-partitions"]![1]!.needs = ["injected"];
    manager.appendCustomEntry("arcwell.feature.checkpoint.v1", injected);
    const forgedApprovalId = createHash("sha256")
      .update(`arcwell.feature.approval.v1\0${saved.sessionId}\0${saved.entryId}\0${saved.digest}`)
      .digest("hex");
    manager.appendCustomEntry("arcwell.feature.approval.v1", {
      approvalId: forgedApprovalId,
      checkpointEntryId: "deadbeef",
      checkpointDigest: "0".repeat(64),
      gate: "approve-plan",
      approved: true,
    });

    const result = await resumeFeatureWorkflow({ cwd: root, ...saved, approvePlan: true }, ledger);
    assert.deepEqual(result.workerPlan.tasks.map((task) => task.id), ["command", "foundation"]);

    const logPath = listed[0]!.path;
    const approvedLog = readFileSync(logPath, "utf8");
    assert.match(approvedLog, new RegExp(`"checkpointEntryId":"${saved.entryId}"`));
    assert.match(approvedLog, new RegExp(`"checkpointDigest":"${saved.digest}"`));
    const lines = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    const checkpointEntry = lines.find((line) => line.type === "custom" && line.id === saved.entryId) as {
      data: { checkpoint: { artifacts: { "implementation-plan": { steps: Array<{ id: string }> }; "task-partitions": Array<{ id: string }> } } };
    };
    checkpointEntry.data.checkpoint.artifacts["implementation-plan"].steps[0]!.id = "tampered";
    checkpointEntry.data.checkpoint.artifacts["task-partitions"][0]!.id = "tampered";
    writeFileSync(logPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
    await assert.rejects(
      () => resumeFeatureWorkflow({ cwd: root, ...saved, approvePlan: true }, ledger),
      /checkpoint contents changed/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resume rejects changes to relevant project files", async () => {
  const { root, ledger } = workspace();
  try {
    const checkpoint = await prepareFeatureWorkflow({ goal: "implement resume", cwd: root }, agents);
    const saved = await ledger.saveCheckpoint(root, checkpoint);
    writeFileSync(join(root, "src", "cli.ts"), "export const cli = false;\n");
    await assert.rejects(
      () => resumeFeatureWorkflow({ cwd: root, ...saved, approvePlan: true }, ledger),
      /project snapshot has changed/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ledger resume rejects a session file replaced by a symbolic link", async () => {
  const { root, sessions, ledger } = workspace();
  try {
    const checkpoint = await prepareFeatureWorkflow({ goal: "bind session", cwd: root }, agents);
    const saved = await ledger.saveCheckpoint(root, checkpoint);
    const listed = await SessionManager.list(root, sessions);
    const original = listed[0]!.path;
    const moved = `${original}.moved`;
    renameSync(original, moved);
    symlinkSync(moved, original);
    await assert.rejects(
      () => resumeFeatureWorkflow({ cwd: root, ...saved, approvePlan: true }, ledger),
      /session file must not be a symbolic link/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ledger discovery rejects unsafe directories and legacy sessions before Pi opens them", async () => {
  const { root, sessions, ledger } = workspace();
  const outside = mkdtempSync(join(process.cwd(), ".tmp-tests", "ledger-outside-"));
  try {
    symlinkSync(outside, sessions, "dir");
    const checkpoint = await prepareFeatureWorkflow({ goal: "safe ledger", cwd: root }, agents);
    await assert.rejects(() => ledger.saveCheckpoint(root, checkpoint), /must not contain symbolic links/);
    rmSync(sessions);

    const saved = await ledger.saveCheckpoint(root, checkpoint);
    const listed = await SessionManager.list(root, sessions);
    const sessionPath = listed[0]!.path;
    symlinkSync(join(outside, "unrelated.jsonl"), join(sessions, "malicious.jsonl"));
    const original = readFileSync(sessionPath, "utf8");
    const lines = original.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    lines[0]!.version = 1;
    const legacy = `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
    writeFileSync(sessionPath, legacy);
    await assert.rejects(
      () => resumeFeatureWorkflow({ cwd: root, ...saved, approvePlan: true }, ledger),
      /session header does not match/,
    );
    assert.equal(readFileSync(sessionPath, "utf8"), legacy);

    const withoutNewline = original.trimEnd();
    writeFileSync(sessionPath, withoutNewline);
    await assert.rejects(
      () => resumeFeatureWorkflow({ cwd: root, ...saved, approvePlan: true }, ledger),
      /must end with a newline/,
    );
    assert.equal(readFileSync(sessionPath, "utf8"), withoutNewline);

    const originalLines = original.trim().split("\n").map((line) => JSON.parse(line) as { id?: string });
    const parentId = originalLines.at(-1)?.id ?? null;
    const oversizedIdSession = `${original}${JSON.stringify({
      type: "custom",
      id: "a".repeat(5_000),
      parentId,
      timestamp: new Date(0).toISOString(),
      customType: "malicious",
      data: {},
    })}\n`;
    writeFileSync(sessionPath, oversizedIdSession);
    await assert.rejects(
      () => resumeFeatureWorkflow({ cwd: root, ...saved, approvePlan: true }, ledger),
      /entry identifiers are invalid/,
    );
    assert.equal(readFileSync(sessionPath, "utf8"), oversizedIdSession);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("project snapshots reject intermediate symlink escapes and track file mode", async () => {
  const { root, ledger } = workspace();
  const outside = mkdtempSync(join(process.cwd(), ".tmp-tests", "snapshot-outside-"));
  try {
    writeFileSync(join(outside, "outside.ts"), "export const outside = true;\n");
    symlinkSync(outside, join(root, "vendor"), "dir");
    const escapedAgents: PlanAgents = {
      ...agents,
      async scout() {
        return { summary: "project", files: [{ path: "vendor/outside.ts", relevance: "must remain contained" }], risks: [] };
      },
    };
    const escaped = await prepareFeatureWorkflow({ goal: "contain snapshot", cwd: root }, escapedAgents);
    await assert.rejects(() => ledger.saveCheckpoint(root, escaped), /symbolic link/);

    rmSync(join(root, "vendor"));
    symlinkSync(join(outside, "not-created"), join(root, "vendor"), "dir");
    await assert.rejects(() => ledger.saveCheckpoint(root, escaped), /symbolic link/);
    rmSync(join(root, "vendor"));
    if (process.platform !== "win32") {
      chmodSync(join(root, "src", "cli.ts"), 0o755);
      const checkpoint = await prepareFeatureWorkflow({ goal: "track mode", cwd: root }, agents);
      const saved = await ledger.saveCheckpoint(root, checkpoint);
      chmodSync(join(root, "src", "cli.ts"), 0o644);
      await assert.rejects(
        () => resumeFeatureWorkflow({ cwd: root, ...saved, approvePlan: true }, ledger),
        /project snapshot has changed/,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("approval append reserves bounded session space before mutation", () => {
  assert.doesNotThrow(() => assertApprovalAppendBudget(16 * 1024 * 1024 - 4 * 1024));
  assert.throws(() => assertApprovalAppendBudget(16 * 1024 * 1024 - 4 * 1024 + 1), /insufficient space/);
});

test("abort and missing approval fail before appending an approval entry", async () => {
  const { root, sessions, ledger } = workspace();
  try {
    const checkpoint = await prepareFeatureWorkflow({ goal: "implement resume", cwd: root }, agents);
    const saved = await ledger.saveCheckpoint(root, checkpoint);
    await assert.rejects(
      () => ledger.loadCheckpoint(root, { ...saved, sessionId: saved.sessionId.toUpperCase() }),
      /exact lowercase identifiers/,
    );
    await assert.rejects(
      () => resumeFeatureWorkflow({ cwd: root, ...saved, approvePlan: false }, ledger),
      /explicit plan approval is required/,
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => resumeFeatureWorkflow({ cwd: root, ...saved, approvePlan: true, signal: controller.signal }, ledger),
      /aborted/,
    );
    const log = readSession(sessions, saved.sessionId);
    assert.equal(log.includes("arcwell.feature.approval.v1"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
