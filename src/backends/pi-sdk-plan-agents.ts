import type { PlanAgents, PlanArtifact, ScoutArtifact } from "../workflows/plan.js";

export type AgentRole = "scout" | "planner" | "worker";

interface AgentSessionRequestBase {
  role: AgentRole;
  cwd: string;
  resourcePolicy: "arcwell-only";
  systemPrompt: string;
  signal?: AbortSignal;
}

export type AgentSessionRequest = AgentSessionRequestBase & ({
  role: "scout" | "planner";
  tools: readonly ["read", "ls"];
  submitTool: "submit_scout_report" | "submit_project_plan";
} | {
  role: "worker";
  tools: readonly ["read", "ls", "write_file"];
  submitTool: "submit_worker_result";
  allowedFiles: string[];
});

export interface AgentSessionHandle {
  prompt(text: string, signal?: AbortSignal): Promise<unknown>;
  dispose(): void;
}

export type AgentSessionFactory = (request: AgentSessionRequest) => Promise<AgentSessionHandle>;

const tools = ["read", "ls"] as const;

const scoutPrompt = `You are Arcwell's read-only project scout.
Inspect only the repository needed for the user's goal. Never propose edits as completed work.
Return exactly one structured report through submit_scout_report. Paths must be repository-relative.
Do not include credentials, environment values, home paths, or raw file contents in the report.`;

const plannerPrompt = `You are Arcwell's read-only project planner.
Use the supplied structured scout report. Produce the smallest coherent implementation task graph.
Every step must have a portable kebab-case id, explicit needs dependencies, repository-relative files,
and a verification command. Independent steps use empty needs. Do not claim work is done.
Return exactly one structured plan through submit_project_plan. Never perform or authorize side effects.`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isScout(value: unknown): value is ScoutArtifact {
  return isRecord(value) && typeof value.summary === "string" && Array.isArray(value.files) && Array.isArray(value.risks);
}

function isPlan(value: unknown): value is PlanArtifact {
  return isRecord(value) && typeof value.goal === "string" && Array.isArray(value.steps) && Array.isArray(value.risks);
}

async function invoke<T>(
  request: AgentSessionRequest,
  prompt: string,
  signal: AbortSignal | undefined,
  factory: AgentSessionFactory,
  validate: (value: unknown) => value is T,
): Promise<T> {
  let session: AgentSessionHandle | undefined;
  try {
    session = await factory(signal ? { ...request, signal } : request);
    const result = await session.prompt(prompt, signal);
    if (!validate(result)) throw new Error(`${request.role} returned no valid structured submission`);
    return result;
  } catch {
    throw new Error(`${request.role} session failed`);
  } finally {
    try {
      session?.dispose();
    } catch {
      throw new Error(`${request.role} session cleanup failed`);
    }
  }
}

export function createBoundedPlanAgents(factory: AgentSessionFactory): PlanAgents {
  return {
    scout(input) {
      return invoke(
        { role: "scout", cwd: input.cwd, tools, resourcePolicy: "arcwell-only", systemPrompt: scoutPrompt, submitTool: "submit_scout_report" },
        `Goal: ${input.goal}`,
        input.signal,
        factory,
        isScout,
      );
    },
    planner(input) {
      return invoke(
        { role: "planner", cwd: input.cwd, tools, resourcePolicy: "arcwell-only", systemPrompt: plannerPrompt, submitTool: "submit_project_plan" },
        `Goal: ${input.goal}\nScout artifact:\n${JSON.stringify(input.scout)}`,
        input.signal,
        factory,
        isPlan,
      );
    },
  };
}
