import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

import { applySetup } from "../src/setup/apply.js";
import { runDoctor } from "../src/setup/doctor.js";
import { createDefaultManifest } from "../src/setup/manifest.js";
import { readOwnership, writeOwnershipAtomic, type ArcwellOwnership } from "../src/setup/ownership.js";
import { ARCWELL_PACKAGE_SOURCE } from "../src/setup/package-source.js";
import type { PiClient, PiPackage } from "../src/setup/pi-client.js";
import { uninstallArcwell } from "../src/setup/uninstall.js";
import { workingAgreementDigest } from "../src/setup/working-agreement.js";
import { fixturePiPackage } from "./setup-package-fixture.js";

const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });
const agreement = "<!-- arcwell:start -->\nArcwell rules\n<!-- arcwell:end -->\n";
const arcwellSource = ARCWELL_PACKAGE_SOURCE;
const ownedSource = "npm:@spences10/pi-lsp@0.0.46";
const preexistingSource = "npm:preexisting@1.0.0";

function piPackage(source: string, scope: PiPackage["scope"] = "user", filtered = false): PiPackage {
  return fixturePiPackage(source, scope, filtered);
}

class FakePiClient implements PiClient {
  readonly removals: string[] = [];
  failRemoval?: string;
  failAfterRemoval?: string;
  failureMessage = "injected package cleanup failure";
  constructor(readonly packages: PiPackage[]) {}
  async version(): Promise<string> { return "pi 0.84.4"; }
  async list(): Promise<PiPackage[]> { return this.packages.map((item) => ({ ...item })); }
  async install(source: string): Promise<void> { this.packages.push(piPackage(source)); }
  async remove(source: string): Promise<void> {
    this.removals.push(source);
    if (source === this.failRemoval) throw new Error(this.failureMessage);
    const identity = source.replace(/^npm:/, "").replace(/@[^@]+$/, "");
    const index = this.packages.findIndex((item) =>
      item.scope === "user" && item.source.replace(/^npm:/, "").replace(/@[^@]+$/, "") === identity);
    if (index >= 0) this.packages.splice(index, 1);
    if (source === this.failAfterRemoval) throw new Error(this.failureMessage);
  }
}

function writeState(root: string, installedPackageSources = [arcwellSource, ownedSource]): ArcwellOwnership {
  writeFileSync(join(root, "AGENTS.md"), `before\n${agreement}after\n`, { mode: 0o640 });
  chmodSync(join(root, "AGENTS.md"), 0o640);
  mkdirSync(join(root, "arcwell"), { recursive: true });
  writeFileSync(join(root, "arcwell", "config.json"), `${JSON.stringify({
    schemaVersion: 1,
    posture: "guarded",
    protections: { effects: true, secrets: true, redaction: true },
  })}\n`, { mode: 0o600 });
  const ownership: ArcwellOwnership = {
    schemaVersion: 1,
    arcwellVersion: "0.3.0",
    manifestDigest: "a".repeat(64),
    installedPackageSources,
    installedResources: [],
    selectedPackageSources: [...installedPackageSources],
    workingAgreementDigest: workingAgreementDigest(agreement),
    workingAgreementExisted: true,
    workingAgreementEndedWithNewline: true,
    arcwellDirectoryExisted: true,
  };
  writeOwnershipAtomic(join(root, "arcwell", "ownership.json"), ownership);
  return ownership;
}

test("uninstall removes only owned user packages and managed state while preserving unrelated bytes and mode", async () => {
  const root = mkdtempSync(join(temporaryRoot, "uninstall-clean-"));
  try {
    writeState(root);
    const client = new FakePiClient([
      piPackage(arcwellSource),
      piPackage(ownedSource),
      piPackage(preexistingSource),
      piPackage(ownedSource, "project"),
    ]);
    const result = await uninstallArcwell({ agentDir: root, piClient: client });

    assert.deepEqual(result.removedPackageSources, [arcwellSource, ownedSource]);
    assert.deepEqual(client.removals, [arcwellSource, ownedSource]);
    assert.deepEqual(client.packages, [
      piPackage(preexistingSource),
      piPackage(ownedSource, "project"),
    ]);
    assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), "before\nafter\n");
    if (process.platform !== "win32") assert.equal(lstatSync(join(root, "AGENTS.md")).mode & 0o777, 0o640);
    assert.equal(existsSync(join(root, "arcwell", "config.json")), false);
    assert.equal(existsSync(join(root, "arcwell", "ownership.json")), false);
    assert.equal(existsSync(join(root, "arcwell")), true, "a directory that predated setup must survive");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uninstall refuses strict unknown ownership before package mutation", async () => {
  const root = mkdtempSync(join(temporaryRoot, "uninstall-preflight-"));
  try {
    writeState(root, [arcwellSource, "npm:unexpected-owner@1.0.0"]);
    const client = new FakePiClient([piPackage(arcwellSource)]);

    await assert.rejects(uninstallArcwell({ agentDir: root, piClient: client }), /ownership|working agreement/i);
    assert.deepEqual(client.removals, []);
    assert.ok(readOwnership(join(root, "arcwell", "ownership.json")));
    assert.ok(existsSync(join(root, "arcwell", "config.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uninstall preserves recoverable state when the managed agreement was modified", async () => {
  const root = mkdtempSync(join(temporaryRoot, "uninstall-modified-agreement-"));
  try {
    writeState(root);
    writeFileSync(join(root, "AGENTS.md"), agreement.replace("Arcwell rules", "modified"));
    const client = new FakePiClient([piPackage(arcwellSource), piPackage(ownedSource)]);

    await assert.rejects(uninstallArcwell({ agentDir: root, piClient: client }), /working agreement was modified/);
    assert.deepEqual(client.removals, []);
    assert.ok(readOwnership(join(root, "arcwell", "ownership.json")));
    assert.ok(existsSync(join(root, "arcwell", "config.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uninstall treats a missing managed agreement as modified and preserves recovery state", async () => {
  const root = mkdtempSync(join(temporaryRoot, "uninstall-missing-agreement-"));
  try {
    writeState(root);
    rmSync(join(root, "AGENTS.md"));
    const client = new FakePiClient([piPackage(arcwellSource), piPackage(ownedSource)]);

    await assert.rejects(uninstallArcwell({ agentDir: root, piClient: client }), /working agreement was modified/);
    assert.deepEqual(client.removals, []);
    assert.ok(readOwnership(join(root, "arcwell", "ownership.json")));
    assert.ok(existsSync(join(root, "arcwell", "config.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("partial package failure preserves ownership and reports removed and remaining state", async () => {
  const root = mkdtempSync(join(temporaryRoot, "uninstall-partial-"));
  try {
    writeState(root);
    const client = new FakePiClient([
      piPackage(arcwellSource),
      piPackage(ownedSource),
    ]);
    client.failRemoval = ownedSource;

    await assert.rejects(
      uninstallArcwell({ agentDir: root, piClient: client }),
      /injected package cleanup failure.*removed.*arcwell.*remaining.*pi-lsp/i,
    );
    const ownership = readOwnership(join(root, "arcwell", "ownership.json"));
    assert.deepEqual(ownership?.installedPackageSources, [ownedSource]);
    assert.deepEqual(ownership?.selectedPackageSources, [arcwellSource, ownedSource]);
    assert.ok(existsSync(join(root, "arcwell", "config.json")));
    assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /arcwell:start/);
    assert.equal(client.packages.some((item) => item.source === arcwellSource && item.scope === "user"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uninstall refuses an additional user source with an owned npm identity before removal", async () => {
  const root = mkdtempSync(join(temporaryRoot, "uninstall-identity-conflict-"));
  try {
    writeState(root);
    const conflictingSource = "npm:@spences10/pi-lsp@0.0.45";
    const client = new FakePiClient([
      piPackage(arcwellSource),
      piPackage(ownedSource),
      piPackage(conflictingSource),
    ]);

    await assert.rejects(
      uninstallArcwell({ agentDir: root, piClient: client }),
      /identity conflict.*pi-lsp.*0\.0\.45/i,
    );
    assert.deepEqual(client.removals, []);
    assert.ok(readOwnership(join(root, "arcwell", "ownership.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uninstall refuses duplicate user entries with the exact owned source before removal", async () => {
  const root = mkdtempSync(join(temporaryRoot, "uninstall-duplicate-owned-source-"));
  try {
    writeState(root);
    const client = new FakePiClient([
      piPackage(arcwellSource),
      piPackage(ownedSource),
      piPackage(ownedSource, "user", true),
    ]);

    await assert.rejects(
      uninstallArcwell({ agentDir: root, piClient: client }),
      /identity conflict.*pi-lsp.*more than one user source/i,
    );
    assert.deepEqual(client.removals, []);
    assert.ok(readOwnership(join(root, "arcwell", "ownership.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uninstall refuses a changed equivalent Git form when the exact owned settings source is absent", async () => {
  const root = mkdtempSync(join(temporaryRoot, "uninstall-changed-git-form-"));
  try {
    writeState(root);
    const changedSource = "git:https://github.com/VincenzoImp/arcwell@v0.3.0";
    const client = new FakePiClient([
      piPackage(changedSource),
      piPackage(ownedSource),
    ]);

    await assert.rejects(
      uninstallArcwell({ agentDir: root, piClient: client }),
      /cannot prove the exact owned settings source.*arcwell/i,
    );
    assert.deepEqual(client.removals, []);
    assert.ok(readOwnership(join(root, "arcwell", "ownership.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uninstall refuses an extra equivalent Git form beside the exact owned settings source", async () => {
  const root = mkdtempSync(join(temporaryRoot, "uninstall-extra-git-form-"));
  try {
    writeState(root);
    const extraSource = "ssh://git@github.com/VincenzoImp/arcwell@v0.3.0";
    const client = new FakePiClient([
      piPackage(arcwellSource),
      piPackage(extraSource),
      piPackage(ownedSource),
    ]);

    await assert.rejects(
      uninstallArcwell({ agentDir: root, piClient: client }),
      /cannot prove the exact owned settings source.*arcwell/i,
    );
    assert.deepEqual(client.removals, []);
    assert.ok(readOwnership(join(root, "arcwell", "ownership.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remove errors reconcile ownership from refreshed Pi inventory", async () => {
  const root = mkdtempSync(join(temporaryRoot, "uninstall-remove-reconcile-"));
  try {
    writeState(root);
    const client = new FakePiClient([piPackage(arcwellSource), piPackage(ownedSource)]);
    client.failAfterRemoval = arcwellSource;

    await assert.rejects(
      uninstallArcwell({ agentDir: root, piClient: client }),
      /removed.*arcwell.*remaining.*pi-lsp/i,
    );
    const ownership = readOwnership(join(root, "arcwell", "ownership.json"));
    assert.deepEqual(ownership?.installedPackageSources, [ownedSource]);
    assert.deepEqual(ownership?.selectedPackageSources, [arcwellSource, ownedSource]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uninstall errors redact the expanded agent directory", async () => {
  const root = mkdtempSync(join(temporaryRoot, "uninstall-redact-path-"));
  try {
    writeState(root, [arcwellSource]);
    const client = new FakePiClient([piPackage(arcwellSource)]);
    client.failRemoval = arcwellSource;
    client.failureMessage = `cleanup failed under ${root}/packages`;

    await assert.rejects(uninstallArcwell({ agentDir: relative(process.cwd(), root), piClient: client }), (error: Error) => {
      assert.equal(error.message.includes(root), false);
      assert.equal(error.message.includes(process.cwd()), false);
      assert.match(error.message, /\$PI_CODING_AGENT_DIR\/packages/);
      return true;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uninstall honors an already-aborted signal without mutation", async () => {
  const root = mkdtempSync(join(temporaryRoot, "uninstall-abort-"));
  try {
    writeState(root);
    const client = new FakePiClient([piPackage(arcwellSource), piPackage(ownedSource)]);
    const controller = new AbortController();
    controller.abort(new Error("stop now"));

    await assert.rejects(uninstallArcwell({ agentDir: root, piClient: client }, controller.signal), /stop now/);
    assert.deepEqual(client.removals, []);
    assert.ok(readOwnership(join(root, "arcwell", "ownership.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("filesystem cleanup failure preserves ownership for an uninstall retry", { skip: process.platform === "win32" }, async () => {
  const root = mkdtempSync(join(temporaryRoot, "uninstall-directory-retry-"));
  try {
    writeFileSync(join(root, "AGENTS.md"), "", { mode: 0o640 });
    const client = new FakePiClient([]);
    await applySetup(createDefaultManifest(), { agentDir: root, piClient: client, workingAgreement: agreement });
    const beforeOwnership = readOwnership(join(root, "arcwell", "ownership.json"))!;
    chmodSync(root, 0o500);

    await assert.rejects(uninstallArcwell({ agentDir: root, piClient: client }), /ownership was preserved for retry/);
    chmodSync(root, 0o700);
    const ownership = readOwnership(join(root, "arcwell", "ownership.json"));
    assert.ok(ownership);
    assert.deepEqual(ownership.installedPackageSources, beforeOwnership.installedPackageSources);
  } finally {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup and uninstall delete AGENTS.md when Arcwell created it and no unrelated bytes remain", async () => {
  const root = mkdtempSync(join(temporaryRoot, "lifecycle-created-agreement-"));
  try {
    const client = new FakePiClient([]);
    await applySetup(createDefaultManifest(), { agentDir: root, piClient: client, workingAgreement: agreement });
    assert.ok(existsSync(join(root, "AGENTS.md")));

    await uninstallArcwell({ agentDir: root, piClient: client });

    assert.equal(existsSync(join(root, "AGENTS.md")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup and uninstall preserve an empty pre-existing AGENTS.md", async () => {
  const root = mkdtempSync(join(temporaryRoot, "lifecycle-empty-agreement-"));
  try {
    const agents = join(root, "AGENTS.md");
    writeFileSync(agents, "", { mode: 0o640 });
    chmodSync(agents, 0o640);
    const client = new FakePiClient([]);
    await applySetup(createDefaultManifest(), { agentDir: root, piClient: client, workingAgreement: agreement });

    await uninstallArcwell({ agentDir: root, piClient: client });

    assert.equal(existsSync(agents), true);
    assert.equal(readFileSync(agents, "utf8"), "");
    if (process.platform !== "win32") assert.equal(lstatSync(agents).mode & 0o777, 0o640);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup and uninstall restore a pre-existing AGENTS.md without a final newline", async () => {
  const root = mkdtempSync(join(temporaryRoot, "lifecycle-no-final-newline-"));
  try {
    const agents = join(root, "AGENTS.md");
    const original = "Personal instructions";
    writeFileSync(agents, original, { mode: 0o640 });
    chmodSync(agents, 0o640);
    const client = new FakePiClient([]);
    await applySetup(createDefaultManifest(), { agentDir: root, piClient: client, workingAgreement: agreement });

    await uninstallArcwell({ agentDir: root, piClient: client });

    assert.equal(readFileSync(agents, "utf8"), original);
    if (process.platform !== "win32") assert.equal(lstatSync(agents).mode & 0o777, 0o640);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup and uninstall preserve a pre-existing equivalent Arcwell Git source", async () => {
  const root = mkdtempSync(join(temporaryRoot, "lifecycle-equivalent-arcwell-"));
  try {
    const equivalentSource = "https://github.com/VincenzoImp/arcwell@v0.3.0";
    const equivalentPackage = {
      ...piPackage(equivalentSource),
      installedPath: piPackage(arcwellSource).installedPath,
    };
    const client = new FakePiClient([equivalentPackage]);

    const ownership = await applySetup(createDefaultManifest(), {
      agentDir: root,
      piClient: client,
      workingAgreement: agreement,
    });
    assert.equal(ownership.installedPackageSources.includes(arcwellSource), false);

    const doctor = await runDoctor({ agentDir: root, piClient: client });
    assert.notEqual(doctor.exitStatus, 2);
    await uninstallArcwell({ agentDir: root, piClient: client });

    assert.deepEqual(client.packages, [equivalentPackage]);
    assert.equal(client.removals.includes(arcwellSource), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup to doctor to uninstall restores scratch state without touching a pre-existing package", async () => {
  const root = mkdtempSync(join(temporaryRoot, "lifecycle-scratch-"));
  try {
    const initialAgreement = "Personal instructions\n";
    writeFileSync(join(root, "AGENTS.md"), initialAgreement, { mode: 0o640 });
    chmodSync(join(root, "AGENTS.md"), 0o640);
    const client = new FakePiClient([piPackage(preexistingSource)]);
    const manifest = createDefaultManifest();
    await applySetup(manifest, { agentDir: root, piClient: client, workingAgreement: agreement });

    const doctor = await runDoctor({ agentDir: root, piClient: client });
    assert.notEqual(doctor.exitStatus, 2);
    await uninstallArcwell({ agentDir: root, piClient: client });

    assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), initialAgreement);
    if (process.platform !== "win32") assert.equal(lstatSync(join(root, "AGENTS.md")).mode & 0o777, 0o640);
    assert.deepEqual(client.packages, [piPackage(preexistingSource)]);
    assert.equal(existsSync(join(root, "arcwell", "config.json")), false);
    assert.equal(existsSync(join(root, "arcwell", "ownership.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
