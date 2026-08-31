import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

import { workflowSchema } from "../src/workflows/schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(process.cwd(), "test", "fixtures", "workflow.json");
const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });

test("workflow schema is strict and exposes bounded node variants", () => {
  assert.equal(workflowSchema.title, "Experimental Arcwell workflow graph");
  assert.equal(workflowSchema.additionalProperties, false);
  assert.equal(workflowSchema.properties.maxConcurrency.maximum, 8);
  assert.equal(workflowSchema.properties.nodes.maxItems, 32);
  assert.equal(workflowSchema.$defs.node.oneOf.length, 3);
  assert.equal(workflowSchema.$defs.node.oneOf.every((node) => node.additionalProperties === false), true);

  const validate = new Ajv2020({ strict: true }).compile(workflowSchema);
  const valid = JSON.parse(readFileSync(fixture, "utf8")) as {
    description: string;
    maxConcurrency: number;
    nodes: Array<Record<string, unknown>>;
  };
  assert.equal(validate(valid), true);
  valid.description = " ";
  assert.equal(validate(valid), false);
  valid.description = "valid";
  valid.nodes[0]!.fanOut = 2;
  assert.equal(validate(valid), false);
  valid.nodes[0]!.fanOut = 1;
  valid.maxConcurrency = 1;
  valid.nodes[2]!.fanOut = 2;
  assert.equal(validate(valid), false);
});

test("workflow validate is deterministic and read-only", () => {
  const root = mkdtempSync(join(temporaryRoot, "workflow-validate-"));
  try {
    const graph = join(root, "workflow.json");
    const home = join(root, "home");
    mkdirSync(home);
    writeFileSync(graph, readFileSync(fixture));
    const before = readdirSync(root);
    const contentBefore = readFileSync(graph);
    const cli = join(here, "..", "src", "cli.js");
    const args = [cli, "experimental", "workflow", "validate", "--file", graph, "--json"];
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    const first = execFileSync(process.execPath, args, { cwd: root, encoding: "utf8", env });
    const second = execFileSync(process.execPath, args, { cwd: root, encoding: "utf8", env });
    const plan = JSON.parse(first) as { name: string; waves: unknown[]; maxAgents: number };
    assert.equal(first, second);
    assert.equal(plan.name, "small-feature");
    assert.equal(plan.waves.length, 4);
    assert.equal(plan.maxAgents, 1);
    assert.deepEqual(readdirSync(root), before);
    assert.deepEqual(readFileSync(graph), contentBefore);
    assert.deepEqual(readdirSync(home), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workflow validate reports malformed JSON and graph paths", () => {
  const root = mkdtempSync(join(temporaryRoot, "workflow-invalid-"));
  try {
    const graph = join(root, "broken.json");
    writeFileSync(graph, "{\"schemaVersion\":");
    const cli = join(here, "..", "src", "cli.js");
    const result = spawnSync(process.execPath, [cli, "experimental", "workflow", "validate", "--file", graph, "--json"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /could not read valid JSON/);
    assert.equal(result.stdout, "");

    writeFileSync(graph, JSON.stringify({ schemaVersion: 1, name: "broken", description: "broken", maxConcurrency: 1, nodes: [] }));
    const structural = spawnSync(process.execPath, [cli, "experimental", "workflow", "validate", "--file", graph, "--json"], { encoding: "utf8" });
    assert.equal(structural.status, 2);
    assert.match(structural.stderr, /nodes/);
    assert.equal(structural.stdout, "");

    const injected = JSON.parse(readFileSync(fixture, "utf8")) as Record<string, unknown>;
    injected["\u001b[2J"] = true;
    writeFileSync(graph, JSON.stringify(injected));
    const diagnostic = spawnSync(process.execPath, [cli, "experimental", "workflow", "validate", "--file", graph], { encoding: "utf8" });
    assert.equal(diagnostic.status, 2);
    assert.equal(diagnostic.stderr.includes("\u001b"), false);
    assert.match(diagnostic.stderr, /\\u001b\[2J/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
