import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

import { explainManifest } from "../src/explain.js";
import { loadManifest } from "../src/manifest.js";
import { manifestSchema } from "../src/schema.js";

const fixture = join(process.cwd(), "test", "fixtures", "full.json");

test("manifest schema is strict, portable, and mirrors the supported vocabulary", () => {
  assert.equal(manifestSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(manifestSchema.title, "Experimental Arcwell manifest");
  assert.equal(manifestSchema.additionalProperties, false);
  assert.deepEqual(manifestSchema.required, ["schemaVersion", "profile", "posture", "intelligence", "modules"]);
  assert.deepEqual(manifestSchema.properties.profile.enum, ["core", "full", "custom"]);
  assert.equal(JSON.stringify(manifestSchema).includes(process.env.HOME ?? "__missing_home__"), false);
  const validate = new Ajv2020({ strict: true }).compile(manifestSchema);
  const validManifest = JSON.parse(readFileSync(fixture, "utf8")) as {
    posture: string;
    modules: { sandbox: boolean };
  };
  assert.equal(validate(validManifest), true);
  validManifest.posture = "isolated";
  validManifest.modules.sandbox = false;
  assert.equal(validate(validManifest), false);
});

test("explain reports effective ownership, provenance, and lazy activation", () => {
  const explanation = explainManifest(loadManifest(fixture));
  assert.equal(explanation.schemaVersion, 1);
  assert.equal(explanation.selection.executionBackend, "subagent");
  assert.equal(explanation.capabilities.length, explanation.plan.operations.length);
  assert.equal(explanation.capabilities.every((entry) => entry.provenance.source.length > 0), true);
  assert.equal(explanation.capabilities.find((entry) => entry.id === "integration.mcp")?.activation, "lazy");
  assert.deepEqual(
    explanation.capabilities.find((entry) => entry.id === "integration.herdr")?.ownership,
    { owner: "arcwell", lifecycle: "managed" },
  );
  assert.deepEqual(
    explanation.capabilities.find((entry) => entry.id === "integration.herdr.pi")?.ownership,
    { owner: "herdr", lifecycle: "delegated" },
  );
  assert.equal(JSON.stringify(explanation).includes(fixture), false);
  assert.equal(JSON.stringify(explanation).includes(readFileSync(fixture, "utf8")), false);
});
