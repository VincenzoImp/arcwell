import type { FeatureWorkerAgent } from "../workflows/feature-worker.js";
import type { AgentSessionFactory, AgentSessionHandle, AgentSessionRequest } from "./pi-sdk-plan-agents.js";

const systemPrompt = `You are Arcwell's bounded implementation worker.
Work only in the isolated workspace and only on the files declared by the approved task.
Use read and ls for context. Use write_file to create or replace approved files; no shell or deletion is available.
Do not include credentials, machine paths, or raw file contents in the final artifact.
When the task is complete, call submit_worker_result exactly once with a concise summary and verification notes.
Never claim a verification command ran because this worker has no shell.`;

function isResult(value: unknown): value is { summary: string; verificationNotes: string[] } {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).summary === "string"
    && Array.isArray((value as Record<string, unknown>).verificationNotes)
    && ((value as Record<string, unknown>).verificationNotes as unknown[]).every((note) => typeof note === "string");
}

export function createPiSdkWorkerAgent(factory: AgentSessionFactory): FeatureWorkerAgent {
  return {
    async execute(input) {
      let session: AgentSessionHandle | undefined;
      const request: AgentSessionRequest = {
        role: "worker",
        cwd: input.cwd,
        tools: ["read", "ls", "write_file"],
        resourcePolicy: "arcwell-only",
        systemPrompt,
        submitTool: "submit_worker_result",
        allowedFiles: [...input.task.files],
        ...(input.signal ? { signal: input.signal } : {}),
      };
      try {
        session = await factory(request);
        const result = await session.prompt(
          `Project summary: ${input.projectSummary}\nApproved task: ${JSON.stringify(input.task)}`,
          input.signal,
        );
        if (!isResult(result)) throw new Error("worker returned no valid structured submission");
        return result;
      } catch {
        throw new Error("worker session failed");
      } finally {
        session?.dispose();
      }
    },
  };
}
