import { moduleNames, packNames, postures, profiles, workflowNames } from "./manifest.js";

const booleanProperties = Object.fromEntries(moduleNames.map((name) => [name, { type: "boolean" }]));

const profileRule = (profile: "core" | "full", packs: string[], workflows: string[]) => ({
  if: { type: "object", properties: { profile: { const: profile } }, required: ["profile"] },
  then: {
    type: "object",
    properties: {
      intelligence: {
        type: "object",
        properties: {
          packs: { type: "array", allOf: packs.map((value) => ({ contains: { const: value } })) },
          workflows: { type: "array", allOf: workflows.map((value) => ({ contains: { const: value } })) },
        },
      },
      modules: { type: "object", properties: { claudeCode: { const: true }, mcp: { const: true } } },
    },
  },
});

const isolatedRule = {
  if: { type: "object", properties: { posture: { const: "isolated" } }, required: ["posture"] },
  then: {
    type: "object",
    properties: {
      modules: { type: "object", properties: { sandbox: { const: true } }, required: ["sandbox"] },
    },
  },
};

export const manifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://arcwell.dev/schema/manifest-v1.json",
  title: "Experimental Arcwell manifest",
  description: "Legacy Experimental capability and execution policy selection; not accepted by stable v1 setup.",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "profile", "posture", "intelligence", "modules"],
  allOf: [
    profileRule("core", ["core"], ["bugfix", "feature", "plan", "review"]),
    profileRule("full", ["core", "engineering", "security"], ["audit", "bugfix", "feature", "plan", "research", "review"]),
    isolatedRule,
  ],
  properties: {
    schemaVersion: { const: 1 },
    profile: { type: "string", enum: [...profiles] },
    posture: { type: "string", enum: [...postures] },
    intelligence: {
      type: "object",
      additionalProperties: false,
      required: ["packs", "workflows"],
      properties: {
        packs: { type: "array", uniqueItems: true, items: { type: "string", enum: [...packNames] } },
        workflows: { type: "array", uniqueItems: true, items: { type: "string", enum: [...workflowNames] } },
      },
    },
    modules: {
      type: "object",
      additionalProperties: false,
      required: [...moduleNames],
      properties: booleanProperties,
    },
  },
} as const;
