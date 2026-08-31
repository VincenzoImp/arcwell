import { verificationChecks, workflowBackends, workflowRoles, workflowWorkspaces } from "./types.js";

const identifier = { type: "string", pattern: "^[a-z][a-z0-9-]{0,62}$" } as const;
const identifiers = { type: "array", uniqueItems: true, items: identifier } as const;
const commonProperties = {
  id: identifier,
  needs: identifiers,
  inputs: identifiers,
  outputs: identifiers,
  objective: { type: "string", minLength: 1, pattern: "\\S" },
  retries: { type: "integer", minimum: 0, maximum: 2 },
} as const;
const commonRequired = ["id", "kind", "needs", "inputs", "outputs", "objective", "retries"] as const;

const agentNode = {
  type: "object",
  additionalProperties: false,
  required: [...commonRequired, "role", "access", "workspace", "backend", "fanOut"],
  properties: {
    ...commonProperties,
    kind: { const: "agent" },
    role: { type: "string", enum: [...workflowRoles] },
    access: { type: "string", enum: ["read", "write"] },
    workspace: { type: "string", enum: [...workflowWorkspaces] },
    workspaceSource: identifier,
    backend: { type: "string", enum: [...workflowBackends] },
    fanOut: { type: "integer", minimum: 1, maximum: 8 },
  },
  allOf: [
    {
      if: { properties: { access: { const: "write" } }, required: ["access"] },
      then: { properties: { workspace: { const: "isolated" } } },
    },
    {
      if: {
        properties: { access: { const: "read" }, workspace: { const: "isolated" } },
        required: ["access", "workspace"],
      },
      then: { properties: { workspaceSource: identifier }, required: ["workspaceSource"] },
    },
    {
      if: { properties: { workspace: { const: "shared" } }, required: ["workspace"] },
      then: { not: { required: ["workspaceSource"] } },
    },
    {
      if: { properties: { role: { enum: ["scout", "planner", "reviewer"] } }, required: ["role"] },
      then: { properties: { fanOut: { const: 1 } } },
    },
  ],
} as const;

const gateNode = {
  type: "object",
  additionalProperties: false,
  required: [...commonRequired, "approval"],
  properties: {
    ...commonProperties,
    kind: { const: "gate" },
    retries: { const: 0 },
    approval: { const: "user" },
  },
} as const;

const verifyNode = {
  type: "object",
  additionalProperties: false,
  required: [...commonRequired, "checks", "workspace", "workspaceSource"],
  properties: {
    ...commonProperties,
    kind: { const: "verify" },
    checks: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", enum: [...verificationChecks] },
    },
    workspace: { const: "isolated" },
    workspaceSource: identifier,
  },
} as const;

const concurrencyRules = Array.from({ length: 8 }, (_, index) => {
  const maximum = index + 1;
  return {
    if: { properties: { maxConcurrency: { const: maximum } }, required: ["maxConcurrency"] },
    then: {
      properties: {
        nodes: {
          type: "array",
          items: {
            type: "object",
            if: { properties: { kind: { const: "agent" } }, required: ["kind"] },
            then: { properties: { fanOut: { type: "integer", maximum } } },
          },
        },
      },
    },
  };
});

export const workflowSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://arcwell.dev/schema/workflow-v1.json",
  title: "Experimental Arcwell workflow graph",
  description: "A legacy Experimental bounded workflow graph. Validation does not execute the graph.",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "name", "description", "maxConcurrency", "nodes"],
  allOf: concurrencyRules,
  properties: {
    schemaVersion: { const: 1 },
    name: identifier,
    description: { type: "string", minLength: 1, pattern: "\\S" },
    maxConcurrency: { type: "integer", minimum: 1, maximum: 8 },
    nodes: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      items: { $ref: "#/$defs/node" },
    },
  },
  $defs: {
    node: { oneOf: [agentNode, gateNode, verifyNode] },
  },
} as const;
