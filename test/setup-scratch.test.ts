import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

import { applySetup } from "../src/setup/apply.js";
import { runDoctor } from "../src/setup/doctor.js";
import { createDefaultManifest } from "../src/setup/manifest.js";
import { readOwnership } from "../src/setup/ownership.js";
import type { PiClient, PiPackage } from "../src/setup/pi-client.js";
import { uninstallArcwell } from "../src/setup/uninstall.js";
import { fixturePiPackage } from "./setup-package-fixture.js";

const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });
const agreement = "<!-- arcwell:start -->\nScratch Arcwell rules\n<!-- arcwell:end -->\n";

interface ScratchEntry {
  path: string;
  type: "directory" | "file";
  content?: string;
  mode: number;
}

function snapshotTree(root: string): ScratchEntry[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .map((entry): ScratchEntry => {
      const path = join(entry.parentPath, entry.name);
      const stat = lstatSync(path);
      return {
        path: relative(root, path).replaceAll("\\", "/"),
        type: entry.isDirectory() ? "directory" : "file",
        ...(entry.isFile() ? { content: readFileSync(path, "utf8") } : {}),
        mode: stat.mode & 0o777,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

test("local scratch setup, idempotent setup, doctor, and uninstall restore the exact filesystem", async () => {
  const root = mkdtempSync(join(temporaryRoot, "setup-scratch-"));
  try {
    const packages: PiPackage[] = [fixturePiPackage("npm:preexisting@1.0.0")];
    const installs: string[] = [];
    const removals: string[] = [];
    const client: PiClient = {
      async version() { return "pi 0.84.4"; },
      async list() { return packages.map((item) => ({ ...item })); },
      async install(source) {
        installs.push(source);
        packages.push(fixturePiPackage(source));
      },
      async remove(source) {
        removals.push(source);
        const index = packages.findIndex((item) => item.source === source);
        if (index >= 0) packages.splice(index, 1);
      },
    };
    const agents = join(root, "AGENTS.md");
    writeFileSync(agents, "Personal instructions\n", { mode: 0o640 });
    chmodSync(agents, 0o640);
    const initialTree = snapshotTree(root);
    const initialPackages = packages.map((item) => ({ ...item }));

    const managedResources = [
      { path: "agents/reviewer.md", content: "---\nname: reviewer\n---\nreview the diff\n" },
      { path: "presets.json", content: '{"presets":{}}\n' },
    ];
    const setupDependencies = { agentDir: root, piClient: client, workingAgreement: agreement, managedResources };

    const manifest = createDefaultManifest();
    const first = await applySetup(manifest, setupDependencies);
    const afterFirst = snapshotTree(root);
    const second = await applySetup(manifest, setupDependencies);
    const doctor = await runDoctor({ agentDir: root, piClient: client });

    assert.deepEqual(second, first);
    assert.deepEqual(snapshotTree(root), afterFirst);
    assert.equal(installs.length, first.installedPackageSources.length);
    assert.deepEqual(readOwnership(join(root, "arcwell", "ownership.json"))?.installedPackageSources, installs);
    assert.equal(doctor.status, "healthy");
    assert.equal(doctor.exitStatus, 0);
    // The subagent definitions and presets must be on disk for the extensions that read them
    // to work at all, and an idempotent second setup must leave them untouched.
    assert.equal(readFileSync(join(root, "agents", "reviewer.md"), "utf8"), managedResources[0]!.content);
    assert.deepEqual(first.installedResources.map((entry) => entry.path), ["agents/reviewer.md", "presets.json"]);
    assert.ok(doctor.checks.some((check) => check.id === "resources" && check.status === "ok"));
    assert.match(readFileSync(agents, "utf8"), /^Personal instructions\n/);
    if (process.platform !== "win32") assert.equal(lstatSync(agents).mode & 0o777, 0o640);

    const uninstalled = await uninstallArcwell({ agentDir: root, piClient: client });
    assert.deepEqual(uninstalled.removedPackageSources, installs);
    assert.deepEqual(uninstalled.removedResources, ["agents/reviewer.md", "presets.json"]);
    assert.deepEqual(uninstalled.keptResources, []);
    assert.deepEqual(removals, installs);
    assert.deepEqual(packages, initialPackages);
    assert.deepEqual(snapshotTree(root), initialTree);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
