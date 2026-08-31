import { parseRunOptions } from "./run-options.js";
import { runPlanWorkflow, type PlanAgents } from "./workflows/plan.js";

export interface RunIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export async function runPlanCommand(
  argv: string[],
  io: RunIo,
  agents: PlanAgents,
  signal?: AbortSignal,
): Promise<number> {
  const options = parseRunOptions(argv, io, "run plan");
  if (!options) return 2;
  const input = signal
    ? { goal: options.goal, cwd: options.cwd, signal }
    : { goal: options.goal, cwd: options.cwd };
  const result = await runPlanWorkflow(input, agents, (event) => {
    io.stderr(`[${event.node}] ${event.status}\n`);
  });

  if (options.json) {
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.status === "succeeded" && result.artifacts.plan) {
    io.stdout(`Arcwell project plan: ${result.artifacts.plan.goal}\n`);
    for (const [index, step] of result.artifacts.plan.steps.entries()) {
      io.stdout(`${index + 1}. ${step.description}\n   Files: ${step.files.join(", ") || "none"}\n   Verify: ${step.verification}\n`);
    }
  } else {
    io.stderr(`arcwell: ${result.error?.message ?? "workflow failed"}\n`);
  }

  return result.status === "succeeded" ? 0 : result.status === "aborted" ? 130 : 1;
}
