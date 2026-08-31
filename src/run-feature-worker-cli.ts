import { statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { sanitizeDiagnostic } from "./diagnostic.js";
import type { RunIo } from "./run-cli.js";
import { PiFeatureLedger, type FeatureLedger } from "./workflows/feature-ledger.js";
import {
  defaultFeatureWorkspaceRoot,
  runFeatureWorker,
  type FeatureWorkerAgent,
} from "./workflows/feature-worker.js";

export async function runFeatureWorkerCommand(
  argv: string[],
  io: RunIo,
  agent: FeatureWorkerAgent,
  ledger: FeatureLedger = new PiFeatureLedger(),
  signal?: AbortSignal,
  workspaceRootOverride?: string,
): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        session: { type: "string" },
        checkpoint: { type: "string" },
        "checkpoint-digest": { type: "string" },
        approval: { type: "string" },
        task: { type: "string" },
        cwd: { type: "string", default: "." },
        json: { type: "boolean", default: false },
      },
    }).values;
  } catch (error) {
    io.stderr(`arcwell: ${sanitizeDiagnostic(error)}\n`);
    return 2;
  }
  const sessionId = typeof values.session === "string" ? values.session : "";
  const entryId = typeof values.checkpoint === "string" ? values.checkpoint : "";
  const digest = typeof values["checkpoint-digest"] === "string" ? values["checkpoint-digest"] : "";
  const approvalId = typeof values.approval === "string" ? values.approval : "";
  const taskId = typeof values.task === "string" ? values.task : "";
  if (!/^[0-9a-f-]{36}$/.test(sessionId) || !/^[0-9a-f]{8}$/.test(entryId)
    || !/^[0-9a-f]{64}$/.test(digest) || !/^[0-9a-f]{64}$/.test(approvalId)
    || !/^[a-z][a-z0-9-]{0,62}$/.test(taskId)) {
    io.stderr("arcwell: run feature worker: exact session, checkpoint, digest, approval, and task identifiers are required\n");
    return 2;
  }
  const cwd = resolve(typeof values.cwd === "string" ? values.cwd : ".");
  try {
    if (!statSync(cwd).isDirectory()) throw new Error("not a directory");
  } catch {
    io.stderr("arcwell: run feature worker: --cwd must name an existing directory\n");
    return 2;
  }
  const workspaceRoot = resolve(workspaceRootOverride ?? defaultFeatureWorkspaceRoot());
  try {
    io.stderr(`[worker:${taskId}] isolated worker started\n`);
    const result = await runFeatureWorker({
      cwd, workspaceRoot, sessionId, entryId, digest, approvalId, taskId,
      ...(signal ? { signal } : {}),
    }, ledger, agent);
    if (values.json) io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    else {
      io.stdout(`Arcwell worker completed ${result.taskId} in isolated workspace ${result.workspaceId}.\n`);
      io.stdout(`${result.changes.length} bounded change(s) recorded; the project was not modified or integrated.\n`);
    }
    return 0;
  } catch (error) {
    if (signal?.aborted) {
      io.stderr("arcwell: isolated worker aborted\n");
      return 130;
    }
    io.stderr(`arcwell: ${sanitizeDiagnostic(error)}\n`);
    return 1;
  }
}
