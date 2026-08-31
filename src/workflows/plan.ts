import { isAbsolute, resolve } from "node:path";

export interface ScoutArtifact {
  summary: string;
  files: Array<{ path: string; relevance: string }>;
  risks: string[];
}

export interface PlanArtifact {
  goal: string;
  steps: Array<{ id: string; needs: string[]; description: string; files: string[]; verification: string }>;
  risks: string[];
}

export interface PlanAgents {
  scout(input: { goal: string; cwd: string; signal?: AbortSignal }): Promise<ScoutArtifact>;
  planner(input: { goal: string; cwd: string; scout: ScoutArtifact; signal?: AbortSignal }): Promise<PlanArtifact>;
}

export interface PlanRunEvent {
  node: "scout" | "planner";
  status: "started" | "succeeded" | "failed" | "aborted";
}

export interface PlanRunResult {
  schemaVersion: 1;
  workflow: "plan";
  status: "succeeded" | "failed" | "aborted";
  artifacts: { scout?: ScoutArtifact; plan?: PlanArtifact };
  error?: {
    node: "scout" | "planner";
    code: "agent_failed" | "aborted" | "invalid_artifact";
    message: string;
  };
}

function pathIsPortable(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const windowsReserved = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])(?:\.|$)/i;
  return path.length > 0 && path.length <= 512 && path === normalized && !isAbsolute(path) && !normalized.startsWith("/") && !/^[A-Za-z]:/.test(normalized)
    && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".."
      && !/[<>:"|?*\u0000-\u001F]/.test(segment) && !/[. ]$/.test(segment) && !windowsReserved.test(segment));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function textIsPortable(value: string, cwd: string): boolean {
  if (value.length > 16_384) return false;
  const roots = [resolve(cwd), process.env.HOME]
    .filter((root): root is string => typeof root === "string" && root.length > 1)
    .flatMap((root) => [root, root.replaceAll("\\", "/")]);
  if (roots.some((root) => value.includes(root)) || /\b[a-z][a-z0-9+.-]*:\/\/\//i.test(value)) return false;
  const withoutWebUrls = value.replace(/\bhttps?:\/\/[^\s"'`)\]]+/gi, "");
  return !/(?:^|[^A-Za-z0-9/])(?:~[\\/]|\\\\[^\\\s]+[\\/]|\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*|[A-Za-z]:[\\/])/.test(withoutWebUrls);
}

function validStrings(values: string[], cwd: string): boolean {
  return values.every((value) => typeof value === "string" && value.trim().length > 0 && textIsPortable(value, cwd));
}

export function validateScoutArtifact(value: unknown, cwd: string): value is ScoutArtifact {
  return isRecord(value) && hasOnlyKeys(value, ["summary", "files", "risks"])
    && typeof value.summary === "string" && value.summary.trim().length > 0 && textIsPortable(value.summary, cwd)
    && Array.isArray(value.files) && value.files.length <= 256
    && value.files.every((file) => isRecord(file) && hasOnlyKeys(file, ["path", "relevance"])
      && typeof file.relevance === "string" && file.relevance.length <= 4_096
      && textIsPortable(file.relevance, cwd) && typeof file.path === "string" && pathIsPortable(file.path))
    && Array.isArray(value.risks) && value.risks.length <= 64 && validStrings(value.risks, cwd);
}

function validPlanSteps(steps: unknown[], cwd: string): boolean {
  if (steps.length === 0 || steps.length > 32) return false;
  const ids = new Set<string>();
  for (const step of steps) {
    if (!isRecord(step) || !hasOnlyKeys(step, ["id", "needs", "description", "files", "verification"])
      || typeof step.id !== "string" || !/^[a-z][a-z0-9-]{0,62}$/.test(step.id) || ids.has(step.id)) return false;
    ids.add(step.id);
  }
  const needsById = new Map<string, string[]>();
  for (const step of steps) {
    if (!isRecord(step) || !Array.isArray(step.needs) || step.needs.length > 32
      || !step.needs.every((need: unknown) => typeof need === "string" && ids.has(need))
      || new Set(step.needs).size !== step.needs.length
      || step.needs.includes(step.id)
      || typeof step.description !== "string" || step.description.trim().length === 0 || step.description.length > 8_192 || !textIsPortable(step.description, cwd)
      || typeof step.verification !== "string" || step.verification.trim().length === 0 || step.verification.length > 4_096 || !textIsPortable(step.verification, cwd)
      || !Array.isArray(step.files) || step.files.length === 0 || step.files.length > 64
      || new Set(step.files).size !== step.files.length
      || !step.files.every((path: unknown) => typeof path === "string" && pathIsPortable(path))) return false;
    needsById.set(step.id as string, step.needs as string[]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    if (!(needsById.get(id) ?? []).every(visit)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  return [...ids].every(visit);
}

export function validatePlanArtifact(value: unknown, cwd: string): value is PlanArtifact {
  return isRecord(value) && hasOnlyKeys(value, ["goal", "steps", "risks"])
    && typeof value.goal === "string" && value.goal.trim().length > 0 && textIsPortable(value.goal, cwd)
    && Array.isArray(value.steps) && validPlanSteps(value.steps, cwd)
    && Array.isArray(value.risks) && value.risks.length <= 64 && validStrings(value.risks, cwd);
}

const aborted = (node: "scout" | "planner", artifacts: PlanRunResult["artifacts"]): PlanRunResult => ({
  schemaVersion: 1,
  workflow: "plan",
  status: "aborted",
  artifacts,
  error: { node, code: "aborted", message: "workflow aborted" },
});

export async function runPlanWorkflow(
  input: { goal: string; cwd: string; signal?: AbortSignal },
  agents: PlanAgents,
  onEvent: (event: PlanRunEvent) => void = () => {},
): Promise<PlanRunResult> {
  const artifacts: PlanRunResult["artifacts"] = {};
  if (input.signal?.aborted) return aborted("scout", artifacts);

  onEvent({ node: "scout", status: "started" });
  try {
    artifacts.scout = await agents.scout(input);
  } catch {
    const status = input.signal?.aborted ? "aborted" : "failed";
    onEvent({ node: "scout", status });
    if (status === "aborted") return aborted("scout", artifacts);
    return {
      schemaVersion: 1, workflow: "plan", status: "failed", artifacts,
      error: { node: "scout", code: "agent_failed", message: "scout agent failed" },
    };
  }
  if (input.signal?.aborted) {
    delete artifacts.scout;
    onEvent({ node: "scout", status: "aborted" });
    return aborted("scout", artifacts);
  }
  if (!validateScoutArtifact(artifacts.scout, input.cwd)) {
    onEvent({ node: "scout", status: "failed" });
    return {
      schemaVersion: 1, workflow: "plan", status: "failed", artifacts: {},
      error: { node: "scout", code: "invalid_artifact", message: "scout returned an invalid structured artifact" },
    };
  }
  onEvent({ node: "scout", status: "succeeded" });
  if (input.signal?.aborted) return aborted("planner", artifacts);

  onEvent({ node: "planner", status: "started" });
  try {
    artifacts.plan = await agents.planner({ ...input, scout: artifacts.scout });
  } catch {
    const status = input.signal?.aborted ? "aborted" : "failed";
    onEvent({ node: "planner", status });
    if (status === "aborted") return aborted("planner", artifacts);
    return {
      schemaVersion: 1, workflow: "plan", status: "failed", artifacts,
      error: { node: "planner", code: "agent_failed", message: "planner agent failed" },
    };
  }
  if (input.signal?.aborted) {
    delete artifacts.plan;
    onEvent({ node: "planner", status: "aborted" });
    return aborted("planner", artifacts);
  }
  if (!validatePlanArtifact(artifacts.plan, input.cwd)) {
    onEvent({ node: "planner", status: "failed" });
    return {
      schemaVersion: 1, workflow: "plan", status: "failed", artifacts: { scout: artifacts.scout },
      error: { node: "planner", code: "invalid_artifact", message: "planner returned an invalid structured artifact" },
    };
  }
  const relevantFiles = new Set([
    ...artifacts.scout.files.map((file) => file.path),
    ...artifacts.plan.steps.flatMap((step) => step.files),
  ]);
  if (relevantFiles.size > 256) {
    onEvent({ node: "planner", status: "failed" });
    return {
      schemaVersion: 1, workflow: "plan", status: "failed", artifacts: { scout: artifacts.scout },
      error: { node: "planner", code: "invalid_artifact", message: "plan exceeds the relevant-file budget" },
    };
  }
  onEvent({ node: "planner", status: "succeeded" });
  if (input.signal?.aborted) {
    delete artifacts.plan;
    onEvent({ node: "planner", status: "aborted" });
    return aborted("planner", artifacts);
  }
  return { schemaVersion: 1, workflow: "plan", status: "succeeded", artifacts };
}
