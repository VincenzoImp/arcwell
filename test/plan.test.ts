import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { listCapabilities } from "../src/catalog.js";
import { loadManifest } from "../src/manifest.js";
import { createPlan } from "../src/planner.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(process.cwd(), "test", "fixtures", "full.json");
const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });

test("package bin points at the compiled CLI", () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    bin?: { arcwell?: string };
  };
  assert.equal(packageJson.bin?.arcwell, "dist/src/cli.js");
  assert.equal(existsSync(join(process.cwd(), packageJson.bin?.arcwell ?? "__missing__")), true);
});

test("capability catalog is complete, sorted, and explains optional power", () => {
  const capabilities = listCapabilities();
  assert.deepEqual(
    capabilities.map((capability) => capability.id),
    [...capabilities.map((capability) => capability.id)].sort(),
  );
  assert.equal(capabilities.find((capability) => capability.id === "integration.herdr")?.optional, true);
  assert.equal(capabilities.find((capability) => capability.id === "integration.claude-code")?.lazy, true);
});

test("plan is deterministic and canonical", () => {
  const manifest = loadManifest(fixture);
  const first = createPlan(manifest);
  const second = createPlan(manifest);
  const reordered = createPlan({
    ...manifest,
    intelligence: {
      packs: [...manifest.intelligence.packs].reverse(),
      workflows: [...manifest.intelligence.workflows].reverse(),
    },
  });

  assert.deepEqual(first, second);
  assert.equal(first.manifestDigest, reordered.manifestDigest);
  assert.deepEqual(first.selection.intelligencePacks, ["core", "engineering", "security"]);
  assert.deepEqual(first.selection.workflows, ["audit", "bugfix", "feature", "plan", "research", "review"]);
  assert.equal(first.selection.executionBackend, "subagent");
  assert.match(first.warnings.join("\n"), /persistent nodes/);
  assert.ok(first.operations.length > 0);
  const capabilityIds = new Set(listCapabilities().map((capability) => capability.id));
  assert.equal(first.operations.every((operation) => capabilityIds.has(operation.id)), true);
  assert.deepEqual(
    first.operations.map((operation) => operation.id),
    [...first.operations.map((operation) => operation.id)].sort(),
  );
});

test("portable plan contains no manifest path or machine home", () => {
  const plan = createPlan(loadManifest(fixture));
  const serialized = JSON.stringify(plan);

  assert.equal(serialized.includes(fixture), false);
  assert.equal(serialized.includes(process.env.HOME ?? "__missing_home__"), false);
});

test("invalid and unknown manifest values fail with actionable paths", () => {
  const root = mkdtempSync(join(temporaryRoot, "manifest-"));
  try {
    const invalid = join(root, "invalid.json");
    writeFileSync(invalid, JSON.stringify({ schemaVersion: 2, profile: "magic", posture: "host" }));
    assert.throws(() => loadManifest(invalid), /schemaVersion.*expected 1/);
    const typo = join(root, "typo.json");
    const valid = JSON.parse(readFileSync(fixture, "utf8")) as Record<string, unknown>;
    valid.target = "/machine/path";
    writeFileSync(typo, JSON.stringify(valid));
    assert.throws(() => loadManifest(typo), /target: unknown property/);
    const inertFull = join(root, "inert-full.json");
    writeFileSync(inertFull, JSON.stringify({
      schemaVersion: 1,
      profile: "full",
      posture: "host",
      intelligence: { packs: [], workflows: [] },
      modules: { claudeCode: false, herdr: false, mcp: false, sandbox: false },
    }));
    assert.throws(() => loadManifest(inertFull), /profile full/);
    const duplicates = join(root, "duplicates.json");
    const duplicateManifest = JSON.parse(readFileSync(fixture, "utf8")) as {
      intelligence: { packs: string[] };
    };
    duplicateManifest.intelligence.packs.push("core");
    writeFileSync(duplicates, JSON.stringify(duplicateManifest));
    assert.throws(() => loadManifest(duplicates), /intelligence\.packs.*duplicate/);
    const contradictory = join(root, "isolated-without-sandbox.json");
    const isolated = JSON.parse(readFileSync(fixture, "utf8")) as {
      posture: string;
      modules: { sandbox: boolean };
    };
    isolated.posture = "isolated";
    isolated.modules.sandbox = false;
    writeFileSync(contradictory, JSON.stringify(isolated));
    assert.throws(() => loadManifest(contradictory), /posture isolated.*sandbox must be true/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI JSON plan is read-only", () => {
  const root = mkdtempSync(join(temporaryRoot, "plan-"));
  try {
    const manifest = join(root, "arcwell.json");
    const fakeHome = join(root, "home");
    mkdirSync(fakeHome);
    writeFileSync(manifest, readFileSync(fixture));
    const before = readdirSync(root);
    const manifestBefore = readFileSync(manifest);
    const output = execFileSync(
      process.execPath,
      [join(here, "..", "src", "cli.js"), "experimental", "plan", "--manifest", manifest, "--json"],
      { cwd: root, encoding: "utf8", env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome } },
    );
    const parsed = JSON.parse(output) as { schemaVersion: number; operations: unknown[] };
    assert.equal(parsed.schemaVersion, 1);
    assert.ok(parsed.operations.length > 0);
    assert.deepEqual(readdirSync(root), before);
    assert.deepEqual(readFileSync(manifest), manifestBefore);
    assert.deepEqual(readdirSync(fakeHome), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
