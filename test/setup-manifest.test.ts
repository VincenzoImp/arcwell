import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  ARCWELL_VERSION,
  createDefaultManifest,
  manifestDigest,
  parseManifestJson,
  parseSetupManifest,
} from "../src/setup/manifest.js";
import { moduleNames, protectionNames } from "../src/setup/types.js";

const exactManifest = {
  schemaVersion: 1,
  arcwellVersion: "0.6.0",
  profile: "core",
  posture: "guarded",
  protections: { effects: true, secrets: true, redaction: true },
  providerGuidance: { claudeSubscription: true },
  modules: { lsp: true, context: true, mcp: true, subagents: true, goal: true, claudeCli: false, sandbox: true },
};

test("default setup manifest is the approved portable manifest", () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version?: unknown };
  assert.equal(ARCWELL_VERSION, packageJson.version);
  assert.equal(ARCWELL_VERSION, "0.6.0");
  assert.deepEqual(createDefaultManifest(), exactManifest);
  assert.deepEqual(parseSetupManifest(exactManifest), exactManifest);
  assert.equal(JSON.stringify(exactManifest).includes(process.env.HOME ?? "__no_home__"), false);
});

test("strict parsing rejects unknown fields, wrong versions, and contradictory host posture", () => {
  assert.throws(() => parseSetupManifest({ ...exactManifest, target: "/Users/example/.pi" }), /target: unknown property/);
  assert.throws(() => parseSetupManifest({ ...exactManifest, arcwellVersion: "0.5.1" }), /arcwellVersion.*0\.6\.0/);
  assert.throws(() => parseSetupManifest({ ...exactManifest, schemaVersion: 2 }), /schemaVersion.*1/);
  assert.throws(() => parseSetupManifest({ ...exactManifest, profile: "full" }), /profile.*core/);
  assert.throws(() => parseSetupManifest({ ...exactManifest, posture: "host" }), /host.*protections.*false/);
});

test("every protection and supported module is independently toggleable", () => {
  for (const name of protectionNames) {
    const manifest = structuredClone(exactManifest);
    manifest.protections[name] = false;
    assert.equal(parseSetupManifest(manifest).protections[name], false);
  }
  for (const name of moduleNames) {
    const manifest = structuredClone(exactManifest);
    manifest.modules[name] = !manifest.modules[name];
    assert.equal(parseSetupManifest(manifest).modules[name], manifest.modules[name]);
  }
  const host = structuredClone(exactManifest);
  host.posture = "host";
  host.protections = { effects: false, secrets: false, redaction: false };
  assert.equal(parseSetupManifest(host).posture, "host");
});

test("removed module keys and provider selection are rejected", () => {
  // The last six became Arcwell's own resources: a manifest that still switches them is
  // describing a system that no longer exists, so it fails rather than being ignored.
  for (const name of [
    "codingPreferences", "backgroundTasks", "webUi", "gitCheckpoint", "notifications",
    "todo", "questionnaire", "planMode", "web", "autonomousWorkflows",
  ]) {
    const manifest = structuredClone(exactManifest) as typeof exactManifest & { modules: Record<string, boolean> };
    manifest.modules[name] = false;
    assert.throws(() => parseSetupManifest(manifest), new RegExp(`modules\\.${name}: unknown property`));
  }
  assert.throws(() => parseSetupManifest({ ...exactManifest, providers: { lsp: "other" } }), /providers: unknown property/);
});

test("JSON parsing rejects duplicate properties and digest is canonical", () => {
  const duplicate = JSON.stringify(exactManifest).replace(
    '"profile":"core"',
    '"profile":"core","profile":"core"',
  );
  assert.throws(() => parseManifestJson(duplicate), /duplicate property.*profile/);

  const reordered = {
    modules: exactManifest.modules,
    providerGuidance: exactManifest.providerGuidance,
    protections: exactManifest.protections,
    posture: exactManifest.posture,
    profile: exactManifest.profile,
    arcwellVersion: exactManifest.arcwellVersion,
    schemaVersion: exactManifest.schemaVersion,
  };
  assert.equal(manifestDigest(parseSetupManifest(reordered)), manifestDigest(parseSetupManifest(exactManifest)));
});
