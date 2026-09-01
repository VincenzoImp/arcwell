import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  installManagedResources,
  loadManagedResources,
  MANAGED_RESOURCE_SOURCES,
  managedResourceDigest,
  removeManagedResources,
  verifyManagedResources,
} from "../src/setup/managed-resources.js";

const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });
const scratch = (): string => mkdtempSync(join(temporaryRoot, "managed-"));

const resources = [
  { path: "agents/scout.md", content: "---\nname: scout\n---\nrecon\n" },
  { path: "presets.json", content: "{}\n" },
];

test("the package ships every source the manifest declares as managed", () => {
  const packageRoot = process.cwd();
  for (const { source } of MANAGED_RESOURCE_SOURCES) {
    assert.ok(existsSync(join(packageRoot, source)), `${source} must exist in the package`);
  }
  const loaded = loadManagedResources(packageRoot);
  assert.deepEqual(loaded.map((entry) => entry.path).sort(), [
    "agents/planner.md", "agents/reviewer.md", "agents/scout.md", "agents/worker.md", "presets.json",
  ]);
  // Subagent definitions are only found at <agentDir>/agents, so this is the path that makes
  // the subagent extension work at all.
  assert.match(loaded.find((entry) => entry.path === "agents/scout.md")?.content ?? "", /name:\s*scout/);
});

test("install records a digest and whether the path was already there", () => {
  const root = scratch();
  try {
    const records = installManagedResources(root, resources);
    assert.deepEqual(records.map((entry) => entry.existedBefore), [false, false]);
    assert.equal(records[0]?.digest, managedResourceDigest(resources[0]!.content));
    assert.equal(readFileSync(join(root, "agents/scout.md"), "utf8"), resources[0]!.content);
    assert.deepEqual(verifyManagedResources(root, records), []);

    const second = installManagedResources(root, resources);
    assert.deepEqual(second.map((entry) => entry.existedBefore), [true, true], "reinstall sees its own files");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verification names the files that no longer match", () => {
  const root = scratch();
  try {
    const records = installManagedResources(root, resources);
    writeFileSync(join(root, "presets.json"), '{"edited":true}\n');
    assert.deepEqual(verifyManagedResources(root, records), ["presets.json"]);

    rmSync(join(root, "agents/scout.md"));
    assert.deepEqual(verifyManagedResources(root, records).sort(), ["agents/scout.md", "presets.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("removal takes back only untouched files Arcwell created", () => {
  const root = scratch();
  try {
    const records = installManagedResources(root, resources);
    writeFileSync(join(root, "presets.json"), '{"mine":true}\n');

    const outcome = removeManagedResources(root, records);
    assert.deepEqual(outcome.removed, ["agents/scout.md"]);
    assert.deepEqual(outcome.kept, ["presets.json"], "an edited file is the user's now");
    assert.equal(existsSync(join(root, "agents/scout.md")), false);
    assert.equal(readFileSync(join(root, "presets.json"), "utf8"), '{"mine":true}\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a file that existed before setup is never removed", () => {
  const root = scratch();
  try {
    mkdirSync(join(root, "agents"), { recursive: true });
    writeFileSync(join(root, "agents/scout.md"), "the user's own scout\n");
    const records = installManagedResources(root, resources);
    assert.equal(records[0]?.existedBefore, true);

    const outcome = removeManagedResources(root, records);
    assert.deepEqual(outcome.removed, ["presets.json"]);
    assert.deepEqual(outcome.kept, ["agents/scout.md"]);
    assert.equal(existsSync(join(root, "agents/scout.md")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a path that escapes the agent directory is refused", () => {
  const root = scratch();
  try {
    for (const path of ["../outside.md", "/etc/passwd", "agents/../../escape.md"]) {
      assert.throws(
        () => installManagedResources(root, [{ path, content: "x" }]),
        /not relative|outside/i,
        path,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
