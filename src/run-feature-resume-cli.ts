import { statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { sanitizeDiagnostic } from "./diagnostic.js";
import type { RunIo } from "./run-cli.js";
import { PiFeatureLedger, type FeatureLedger } from "./workflows/feature-ledger.js";
import { resumeFeatureWorkflow } from "./workflows/feature-resume.js";

export async function runFeatureResumeCommand(
  argv: string[],
  io: RunIo,
  ledger: FeatureLedger = new PiFeatureLedger(),
  signal?: AbortSignal,
): Promise<number> {
  let values: {
    session?: string;
    checkpoint?: string;
    "checkpoint-digest"?: string;
    cwd?: string;
    "approve-plan"?: boolean;
    json?: boolean;
  };
  try {
    values = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        session: { type: "string" },
        checkpoint: { type: "string" },
        "checkpoint-digest": { type: "string" },
        cwd: { type: "string", default: "." },
        "approve-plan": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
      },
    }).values;
  } catch (error) {
    io.stderr(`arcwell: ${sanitizeDiagnostic(error)}\n`);
    return 2;
  }
  if (!values.session || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(values.session)) {
    io.stderr("arcwell: run feature resume: --session must be a Pi session UUID\n");
    return 2;
  }
  if (!values.checkpoint || !/^[0-9a-f]{8}$/.test(values.checkpoint)) {
    io.stderr("arcwell: run feature resume: --checkpoint must be an 8-character Pi entry ID\n");
    return 2;
  }
  if (!values["checkpoint-digest"] || !/^[0-9a-f]{64}$/.test(values["checkpoint-digest"])) {
    io.stderr("arcwell: run feature resume: --checkpoint-digest must be a SHA-256 digest\n");
    return 2;
  }
  if (!values["approve-plan"]) {
    io.stderr("arcwell: run feature resume: --approve-plan is required\n");
    return 2;
  }
  const cwd = resolve(values.cwd ?? ".");
  try {
    if (!statSync(cwd).isDirectory()) throw new Error("not a directory");
  } catch {
    io.stderr("arcwell: run feature resume: --cwd must name an existing directory\n");
    return 2;
  }

  try {
    const result = await resumeFeatureWorkflow({
      cwd,
      sessionId: values.session,
      entryId: values.checkpoint,
      digest: values["checkpoint-digest"],
      approvePlan: true,
      ...(signal ? { signal } : {}),
    }, ledger);
    if (values.json) io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    else {
      io.stdout(`Arcwell approved feature plan ${result.checkpoint.sessionId}.\n`);
      io.stdout(`Ready tasks: ${result.workerPlan.firstWave.join(", ")}\n`);
      io.stdout("Stopped at the isolated worker boundary; no workspace was created and no worker was started.\n");
    }
    return 0;
  } catch (error) {
    if (signal?.aborted) {
      io.stderr("arcwell: feature resume aborted\n");
      return 130;
    }
    io.stderr(`arcwell: ${sanitizeDiagnostic(error)}\n`);
    return 1;
  }
}
