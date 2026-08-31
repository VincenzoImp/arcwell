import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createInitialManifest } from "../src/init.js";
import { parseManifest } from "../src/manifest.js";
import { createPlan } from "../src/planner.js";

const here = dirname(fileURLToPath(import.meta.url));
const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });

test("init defaults to a useful guarded Core manifest", () => {
  const manifest = parseManifest(createInitialManifest());
  assert.equal(manifest.profile, "core");
  assert.equal(manifest.posture, "guarded");
  assert.deepEqual(manifest.intelligence.packs, ["core"]);
  assert.deepEqual(manifest.intelligence.workflows, ["bugfix", "feature", "plan", "review"]);
  assert.deepEqual(manifest.modules, { claudeCode: true, herdr: false, mcp: true, sandbox: false });
  assert.equal(createPlan(manifest).operations.some((operation) => operation.id === "policy.effects-guard"), true);
});

test("Full stays powerful without silently enabling persistent or release effects", () => {
  const manifest = parseManifest(createInitialManifest({ profile: "full", posture: "isolated" }));
  assert.deepEqual(manifest.intelligence.packs, ["core", "engineering", "security"]);
  assert.deepEqual(manifest.intelligence.workflows, ["audit", "bugfix", "feature", "plan", "research", "review"]);
  assert.equal(manifest.modules.herdr, false);
  assert.equal(manifest.modules.sandbox, true);
  assert.equal(manifest.intelligence.workflows.includes("release"), false);
});

test("init CLI is deterministic and writes nothing", () => {
  const root = mkdtempSync(join(temporaryRoot, "init-"));
  try {
    const home = join(root, "home");
    mkdirSync(home);
    const before = readdirSync(root);
    const cli = join(here, "..", "src", "cli.js");
    const args = [cli, "experimental", "init", "--profile", "full", "--posture", "host"];
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    const first = execFileSync(process.execPath, args, { cwd: root, encoding: "utf8", env });
    const second = execFileSync(process.execPath, args, { cwd: root, encoding: "utf8", env });
    assert.equal(first, second);
    assert.equal(parseManifest(JSON.parse(first)).profile, "full");
    assert.deepEqual(readdirSync(root), before);
    assert.deepEqual(readdirSync(home), []);
    assert.equal(first.includes(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
