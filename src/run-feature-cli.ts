import { parseRunOptions } from "./run-options.js";
import type { RunIo } from "./run-cli.js";
import { PiFeatureLedger, type FeatureLedger } from "./workflows/feature-ledger.js";
import { prepareFeatureWorkflow } from "./workflows/feature-preparation.js";
import type { PlanAgents } from "./workflows/plan.js";

export async function runFeatureCommand(
  argv: string[],
  io: RunIo,
  agents: PlanAgents,
  signal?: AbortSignal,
  ledger: FeatureLedger = new PiFeatureLedger(),
): Promise<number> {
  const options = parseRunOptions(argv, io, "run feature", true);
  if (!options) return 2;
  const input = signal
    ? { goal: options.goal, cwd: options.cwd, signal }
    : { goal: options.goal, cwd: options.cwd };
  const result = await prepareFeatureWorkflow(input, agents, (event) => {
    io.stderr(`[${event.node}] ${event.status}\n`);
  });
  let output: typeof result | (typeof result & { ledger: { sessionId: string; checkpointEntryId: string; checkpointDigest: string } }) = result;
  if (options.persist && result.status === "blocked") {
    try {
      const saved = await ledger.saveCheckpoint(options.cwd, result, signal);
      signal?.throwIfAborted();
      output = {
        ...result,
        ledger: { sessionId: saved.sessionId, checkpointEntryId: saved.entryId, checkpointDigest: saved.digest },
      };
    } catch {
      if (signal?.aborted) {
        io.stderr("arcwell: feature preparation aborted\n");
        return 130;
      }
      io.stderr("arcwell: feature checkpoint could not be persisted safely\n");
      return 1;
    }
  }

  if (options.json) {
    io.stdout(`${JSON.stringify(output, null, 2)}\n`);
  } else if (result.status === "blocked" && result.artifacts["implementation-plan"]) {
    io.stdout(`Arcwell feature preparation: ${result.artifacts["implementation-plan"].goal}\n`);
    for (const [index, step] of result.artifacts["implementation-plan"].steps.entries()) {
      io.stdout(`${index + 1}. ${step.description}\n   Files: ${step.files.join(", ") || "none"}\n   Verify: ${step.verification}\n`);
    }
    io.stdout("\nStopped at user gate approve-plan. Arcwell stopped before worker scheduling and requested no project mutation.\n");
    if ("ledger" in output) {
      io.stdout(`Checkpoint persisted in Pi session ${output.ledger.sessionId}. Resume requires its entry, digest, and explicit --approve-plan.\n`);
    }
  } else {
    io.stderr(`arcwell: ${result.error?.message ?? "feature preparation failed"}\n`);
  }

  return result.status === "blocked" ? 0 : result.status === "aborted" ? 130 : 1;
}
