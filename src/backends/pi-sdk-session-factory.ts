import {
  createAgentSession,
  defineTool,
  getAgentDir,
  SessionManager,
  type ModelRuntime,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { retryableLazy } from "../retryable-lazy.js";
import { waitWithSignal } from "../wait-with-signal.js";
import { createEphemeralModelRuntime } from "./pi-sdk-runtime.js";
import { createIsolatedResources, createSafeSettings } from "./pi-sdk-resources.js";
import { createProjectReadTools, createProjectWriteTool } from "./project-read-boundary.js";
import type { AgentSessionFactory, AgentSessionRequest } from "./pi-sdk-plan-agents.js";

export { createIsolatedResources } from "./pi-sdk-resources.js";
export { assessReadOnlyToolCall, stableProjectRead, type ToolPolicyDecision } from "./project-read-boundary.js";

function submissionTool(request: AgentSessionRequest, submit: (value: unknown) => void) {
  if (request.role === "scout") {
    return defineTool({
      name: request.submitTool,
      label: "Submit scout report",
      description: "Submit the final structured, repository-relative scout artifact exactly once.",
      parameters: Type.Object({
        summary: Type.String({ minLength: 1, maxLength: 16_384 }),
        files: Type.Array(Type.Object({
          path: Type.String({ minLength: 1, maxLength: 512 }),
          relevance: Type.String({ minLength: 1, maxLength: 4_096 }),
        }, { additionalProperties: false }), { maxItems: 256 }),
        risks: Type.Array(Type.String({ minLength: 1, maxLength: 16_384 }), { maxItems: 64 }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId, params) => {
        submit(params);
        return { content: [{ type: "text" as const, text: "Scout report accepted. Stop now." }], details: {}, terminate: true };
      },
    });
  }
  if (request.role === "worker") {
    return defineTool({
      name: request.submitTool,
      label: "Submit worker result",
      description: "Submit a concise result after writing only approved task files.",
      parameters: Type.Object({
        summary: Type.String({ minLength: 1, maxLength: 4_096 }),
        verificationNotes: Type.Array(Type.String({ minLength: 1, maxLength: 1_024 }), { maxItems: 16 }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId, params) => {
        submit(params);
        return { content: [{ type: "text" as const, text: "Worker result accepted. Stop now." }], details: {}, terminate: true };
      },
    });
  }
  return defineTool({
    name: request.submitTool,
    label: "Submit project plan",
    description: "Submit the final structured project plan exactly once.",
    parameters: Type.Object({
      goal: Type.String({ minLength: 1, maxLength: 16_384 }),
      steps: Type.Array(Type.Object({
        id: Type.String({ pattern: "^[a-z][a-z0-9-]{0,62}$" }),
        needs: Type.Array(Type.String({ pattern: "^[a-z][a-z0-9-]{0,62}$" }), { uniqueItems: true, maxItems: 32 }),
        description: Type.String({ minLength: 1, maxLength: 8_192 }),
        files: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { minItems: 1, maxItems: 64, uniqueItems: true }),
        verification: Type.String({ minLength: 1, maxLength: 4_096 }),
      }, { additionalProperties: false }), { minItems: 1, maxItems: 32 }),
      risks: Type.Array(Type.String({ minLength: 1, maxLength: 16_384 }), { maxItems: 64 }),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, params) => {
      submit(params);
      return { content: [{ type: "text" as const, text: "Project plan accepted. Stop now." }], details: {}, terminate: true };
    },
  });
}

async function createSession(request: AgentSessionRequest, modelRuntime: ModelRuntime) {
  if (request.signal?.aborted) throw new Error("session creation aborted");
  let submitted: unknown;
  let submissionCount = 0;
  const submission = submissionTool(request, (value) => {
    submissionCount += 1;
    if (submissionCount === 1) submitted = value;
  });
  const settingsManager = await createSafeSettings();
  const resourceLoader = await createIsolatedResources(request, settingsManager);
  if (request.signal?.aborted) throw new Error("session creation aborted");
  // Pi's customTools option is invariant in each schema; erase only this heterogeneous SDK boundary.
  const customTools = [
    ...createProjectReadTools(request.cwd),
    ...(request.role === "worker" ? [createProjectWriteTool(request.cwd, request.allowedFiles)] : []),
    submission,
  ] as Array<ToolDefinition<any, any>>;
  const { session } = await createAgentSession({
    cwd: request.cwd,
    agentDir: getAgentDir(),
    resourceLoader,
    settingsManager,
    modelRuntime,
    tools: [...request.tools, request.submitTool],
    noTools: "builtin",
    customTools,
    sessionManager: SessionManager.inMemory(request.cwd),
  });
  if (request.signal?.aborted) {
    session.dispose();
    throw new Error("session creation aborted");
  }
  const expectedTools = [...request.tools, request.submitTool];
  const activeTools = new Set(session.getActiveToolNames());
  const missingTools = expectedTools.filter((name) => !activeTools.has(name));
  if (missingTools.length > 0) {
    session.dispose();
    throw new Error(`isolated session is missing required tools: ${missingTools.join(", ")}`);
  }

  return {
    async prompt(text: string, signal?: AbortSignal) {
      if (signal?.aborted) throw new Error("session aborted");
      const abort = () => { void session.abort(); };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await session.prompt(text);
        if (submissionCount !== 1) throw new Error(`agent must submit exactly one artifact (received ${submissionCount})`);
        return submitted;
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    },
    dispose() {
      session.dispose();
    },
  };
}

export function createPiSdkSessionFactory(): AgentSessionFactory {
  const runtime = retryableLazy(async (_: void) => {
    const signal = AbortSignal.timeout(60_000);
    const initialized = await createEphemeralModelRuntime(signal);
    signal.throwIfAborted();
    return initialized;
  });
  return async (request) => createSession(request, await waitWithSignal(runtime(), request.signal));
}

export const createPiSdkSession: AgentSessionFactory = createPiSdkSessionFactory();
