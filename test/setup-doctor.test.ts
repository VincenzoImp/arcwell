import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { runDoctor } from "../src/setup/doctor.js";
import { PACKAGE_CATALOG } from "../src/setup/catalog.js";
import { writeRuntimeConfigAtomic } from "../src/setup/config.js";
import { ARCWELL_VERSION } from "../src/setup/manifest.js";
import { writeOwnershipAtomic, type ArcwellOwnership } from "../src/setup/ownership.js";
import { ARCWELL_PACKAGE_SOURCE } from "../src/setup/package-source.js";
import { assertArcwellPackageHealthy } from "../src/setup/package-health.js";
import type { PiClient, PiPackage } from "../src/setup/pi-client.js";
import type { RuntimeConfig } from "../src/setup/types.js";
import { workingAgreementDigest } from "../src/setup/working-agreement.js";
import { fixtureInstalledPath, fixturePiPackage } from "./setup-package-fixture.js";

const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });
const agreement = "<!-- arcwell:start -->\nArcwell rules\n<!-- arcwell:end -->\n";
const arcwellSource = ARCWELL_PACKAGE_SOURCE;
const allSources = [arcwellSource, ...PACKAGE_CATALOG.map((entry) => entry.source)];
const guarded: RuntimeConfig = {
  schemaVersion: 1,
  posture: "guarded",
  protections: { effects: true, secrets: true, redaction: true },
};
const healthyArcwellPackageJson = {
  name: "arcwell",
  version: ARCWELL_VERSION,
  type: "module",
  pi: { extensions: ["./dist/extensions/arcwell-protections.js"] },
};

class FakePiClient implements PiClient {
  constructor(
    readonly packages: PiPackage[],
    readonly reportedVersion = "pi 0.84.4",
  ) {}
  async version(): Promise<string> { return this.reportedVersion; }
  async list(): Promise<PiPackage[]> { return this.packages.map((item) => ({ ...item })); }
  async install(): Promise<void> { throw new Error("doctor must not install packages"); }
  async remove(): Promise<void> { throw new Error("doctor must not remove packages"); }
}

function writeHealthyState(
  root: string,
  installedSources = allSources,
  selectedSources = installedSources,
): ArcwellOwnership {
  writeFileSync(join(root, "AGENTS.md"), `personal\n${agreement}`, { mode: 0o640 });
  chmodSync(join(root, "AGENTS.md"), 0o640);
  writeRuntimeConfigAtomic(join(root, "arcwell", "config.json"), guarded);
  const ownership: ArcwellOwnership = {
    schemaVersion: 1,
    arcwellVersion: ARCWELL_VERSION,
    manifestDigest: "a".repeat(64),
    installedPackageSources: [...installedSources],
    installedResources: [],
    selectedPackageSources: [...selectedSources],
    workingAgreementDigest: workingAgreementDigest(agreement),
    workingAgreementExisted: true,
    workingAgreementEndedWithNewline: true,
    arcwellDirectoryExisted: false,
  };
  writeOwnershipAtomic(join(root, "arcwell", "ownership.json"), ownership);
  return ownership;
}

function userPackages(sources: readonly string[]): PiPackage[] {
  return sources.map((source) => fixturePiPackage(source));
}

test("doctor is read-only and reports a fully effective exact setup as healthy", async () => {
  const root = mkdtempSync(join(temporaryRoot, "doctor-healthy-"));
  try {
    writeHealthyState(root);
    const before = {
      agents: readFileSync(join(root, "AGENTS.md")),
      config: readFileSync(join(root, "arcwell", "config.json")),
      ownership: readFileSync(join(root, "arcwell", "ownership.json")),
      mode: lstatSync(join(root, "AGENTS.md")).mode & 0o777,
    };
    const report = await runDoctor({ agentDir: root, piClient: new FakePiClient(userPackages(allSources)) });

    assert.equal(report.exitStatus, 0);
    assert.equal(report.status, "healthy");
    assert.ok(report.checks.every((check) => check.status === "ok"));
    assert.deepEqual(report.guidance, ["Claude subscription authentication is managed by Pi; use /login if desired."]);
    assert.deepEqual({
      agents: readFileSync(join(root, "AGENTS.md")),
      config: readFileSync(join(root, "arcwell", "config.json")),
      ownership: readFileSync(join(root, "arcwell", "ownership.json")),
      mode: lstatSync(join(root, "AGENTS.md")).mode & 0o777,
    }, before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor locates a selected Arcwell package by semantic Git source", async () => {
  const root = mkdtempSync(join(temporaryRoot, "doctor-equivalent-git-"));
  try {
    writeHealthyState(root);
    const equivalentSource = "git:ssh://git@github.com/VincenzoImp/arcwell@v0.1.0";
    const packages = userPackages(allSources.filter((source) => source !== arcwellSource));
    packages.push({
      ...fixturePiPackage(equivalentSource),
      installedPath: fixtureInstalledPath(ARCWELL_PACKAGE_SOURCE),
    });

    const report = await runDoctor({ agentDir: root, piClient: new FakePiClient(packages) });

    assert.equal(report.exitStatus, 0);
    assert.ok(report.checks.some((check) => check.id === "package.arcwell" && check.status === "ok"));
    assert.ok(report.checks.some((check) => check.id === "module.lsp" && check.status === "ok"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor warns only for disabled protections, not disabled optional modules", async () => {
  const root = mkdtempSync(join(temporaryRoot, "doctor-warning-"));
  try {
    const enabledSources = allSources.filter((source) => !source.includes("pi-mcp"));
    writeHealthyState(root, enabledSources);
    writeRuntimeConfigAtomic(join(root, "arcwell", "config.json"), {
      ...guarded,
      protections: { ...guarded.protections, effects: false },
    });
    const report = await runDoctor({ agentDir: root, piClient: new FakePiClient(userPackages(enabledSources)) });

    assert.equal(report.exitStatus, 1);
    assert.equal(report.status, "warnings");
    assert.ok(report.checks.some((check) => check.id === "protection.effects" && check.status === "warning"));
    assert.equal(report.checks.some((check) => check.id === "module.web"), false);
    assert.equal(report.checks.some((check) => check.status === "error"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor errors for selected packages missing at user scope and exact version conflicts", async () => {
  const root = mkdtempSync(join(temporaryRoot, "doctor-package-"));
  try {
    writeHealthyState(root);
    const packages = userPackages(allSources.filter((source) => source !== arcwellSource));
    packages.push(fixturePiPackage(arcwellSource, "project"));
    packages.push(fixturePiPackage("git:github.com/VincenzoImp/arcwell@v0.2.0"));
    const report = await runDoctor({ agentDir: root, piClient: new FakePiClient(packages) });

    assert.equal(report.exitStatus, 2);
    assert.equal(report.status, "errors");
    assert.ok(report.checks.some((check) => check.id === "package.arcwell" && check.status === "error" && /version conflict/.test(check.message)));
    assert.ok(report.checks.some((check) => check.id === "protection.effects" && check.status === "error"));
    assert.ok(report.checks.some((check) => check.id === "protection.secrets" && check.status === "error"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor errors when the Arcwell extension package or a selected external package is filtered", async () => {
  const root = mkdtempSync(join(temporaryRoot, "doctor-filtered-"));
  try {
    const lspSource = PACKAGE_CATALOG.find((entry) => entry.capability === "lsp")!.source;
    writeHealthyState(root);
    const packages = userPackages(allSources);
    packages.find((item) => item.source === arcwellSource)!.filtered = true;
    packages.find((item) => item.source === lspSource)!.filtered = true;

    const report = await runDoctor({ agentDir: root, piClient: new FakePiClient(packages) });

    assert.equal(report.exitStatus, 2);
    assert.ok(report.checks.some((check) => check.id === "package.arcwell" && check.status === "error" && /filtered/.test(check.message)));
    assert.ok(report.checks.some((check) => check.id === "package.lsp" && check.status === "error" && /filtered/.test(check.message)));
    assert.ok(report.checks.some((check) => check.id === "protection.effects" && check.status === "error"));
    assert.ok(report.checks.some((check) => check.id === "protection.secrets" && check.status === "error"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor requires selected packages even when Arcwell did not install them", async () => {
  const root = mkdtempSync(join(temporaryRoot, "doctor-selected-unowned-"));
  try {
    const lspSource = PACKAGE_CATALOG.find((entry) => entry.capability === "lsp")!.source;
    writeHealthyState(root, allSources.filter((source) => source !== lspSource), allSources);
    const report = await runDoctor({
      agentDir: root,
      piClient: new FakePiClient(userPackages(allSources.filter((source) => source !== lspSource))),
    });

    assert.equal(report.exitStatus, 2);
    assert.ok(report.checks.some((check) => check.id === "package.lsp" && check.status === "error" && /missing/.test(check.message)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor rejects invalid Arcwell package metadata, manifest, and extension exports", async (t) => {
  await t.test("metadata", async () => {
    const root = mkdtempSync(join(temporaryRoot, "doctor-package-metadata-"));
    try {
      writeHealthyState(root);
      const packageRoot = join(root, "installed-arcwell");
      mkdirSync(join(packageRoot, "dist", "extensions"), { recursive: true });
      writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ ...healthyArcwellPackageJson, name: "other" }));
      writeFileSync(join(packageRoot, "dist", "extensions", "arcwell-protections.js"), "export default function () {}\n");
      const packages = userPackages(allSources);
      (packages.find((item) => item.source === arcwellSource)! as PiPackage & { installedPath: string }).installedPath = packageRoot;

      const report = await runDoctor({ agentDir: root, piClient: new FakePiClient(packages) });
      assert.equal(report.exitStatus, 2);
      assert.ok(report.checks.some((check) => check.id === "package.arcwell" && check.status === "error" && /name\/version/i.test(check.message)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("missing extension manifest entry", async () => {
    const root = mkdtempSync(join(temporaryRoot, "doctor-package-manifest-"));
    try {
      writeHealthyState(root);
      const packageRoot = join(root, "installed-arcwell");
      mkdirSync(join(packageRoot, "dist", "extensions"), { recursive: true });
      writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
        ...healthyArcwellPackageJson,
        pi: { extensions: [] },
      }));
      writeFileSync(join(packageRoot, "dist", "extensions", "arcwell-protections.js"), "export default function () {}\n");
      const packages = userPackages(allSources);
      (packages.find((item) => item.source === arcwellSource)! as PiPackage & { installedPath: string }).installedPath = packageRoot;

      const report = await runDoctor({ agentDir: root, piClient: new FakePiClient(packages) });
      assert.equal(report.exitStatus, 2);
      assert.ok(report.checks.some((check) => check.id === "package.arcwell" && check.status === "error" && /manifest/i.test(check.message)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("non-function extension default export", async () => {
    const root = mkdtempSync(join(temporaryRoot, "doctor-package-export-"));
    try {
      writeHealthyState(root);
      const packageRoot = join(root, "installed-arcwell");
      mkdirSync(join(packageRoot, "dist", "extensions"), { recursive: true });
      writeFileSync(join(packageRoot, "package.json"), JSON.stringify(healthyArcwellPackageJson));
      writeFileSync(join(packageRoot, "dist", "extensions", "arcwell-protections.js"), "export default {};\n");
      const packages = userPackages(allSources);
      (packages.find((item) => item.source === arcwellSource)! as PiPackage & { installedPath: string }).installedPath = packageRoot;

      const report = await runDoctor({ agentDir: root, piClient: new FakePiClient(packages) });
      assert.equal(report.exitStatus, 2);
      assert.ok(report.checks.some((check) => check.id === "package.arcwell" && check.status === "error" && /default export/i.test(check.message)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("extension syntax", async () => {
    const root = mkdtempSync(join(temporaryRoot, "doctor-package-syntax-"));
    try {
      writeHealthyState(root);
      const packageRoot = join(root, "installed-arcwell");
      mkdirSync(join(packageRoot, "dist", "extensions"), { recursive: true });
      writeFileSync(join(packageRoot, "package.json"), JSON.stringify(healthyArcwellPackageJson));
      writeFileSync(join(packageRoot, "dist", "extensions", "arcwell-protections.js"), "export default (\n");
      const packages = userPackages(allSources);
      (packages.find((item) => item.source === arcwellSource)! as PiPackage & { installedPath: string }).installedPath = packageRoot;

      const report = await runDoctor({ agentDir: root, piClient: new FakePiClient(packages) });
      assert.equal(report.exitStatus, 2);
      assert.ok(report.checks.some((check) => check.id === "package.arcwell" && check.status === "error" && /load/i.test(check.message)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test("Arcwell extension health does not reuse cached syntax after same-size content changes", async () => {
  const root = mkdtempSync(join(temporaryRoot, "doctor-package-cache-"));
  try {
    const packageRoot = join(root, "installed-arcwell");
    const extensionPath = join(packageRoot, "dist", "extensions", "arcwell-protections.js");
    mkdirSync(join(packageRoot, "dist", "extensions"), { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify(healthyArcwellPackageJson));
    const valid = "export default function extension() {}\n";
    writeFileSync(extensionPath, valid);
    const stableTimestamp = new Date(1_700_000_000_000);
    utimesSync(extensionPath, stableTimestamp, stableTimestamp);
    const installed = fixturePiPackage(arcwellSource) as PiPackage & { installedPath: string };
    installed.installedPath = packageRoot;
    await assertArcwellPackageHealthy(installed);

    const timestamps = lstatSync(extensionPath);
    const invalid = "export default function extension( {\n".padEnd(valid.length, " ");
    assert.equal(Buffer.byteLength(invalid), Buffer.byteLength(valid));
    writeFileSync(extensionPath, invalid);
    utimesSync(extensionPath, timestamps.atime, timestamps.mtime);

    await assert.rejects(assertArcwellPackageHealthy(installed), /could not be loaded/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor reports an active unowned deselected catalog package as unhealthy", async () => {
  const root = mkdtempSync(join(temporaryRoot, "doctor-unowned-deselected-"));
  try {
    const mcpSource = PACKAGE_CATALOG.find((entry) => entry.capability === "mcp")!.source;
    const selected = allSources.filter((source) => source !== mcpSource);
    writeHealthyState(root, selected);
    const report = await runDoctor({ agentDir: root, piClient: new FakePiClient(userPackages([...selected, mcpSource])) });

    assert.equal(report.exitStatus, 2);
    assert.ok(report.checks.some((check) => check.id === "package.unowned.mcp" && check.status === "error"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor detects modified agreement, ineffective redaction, incompatible Pi, and invalid ownership", async () => {
  const root = mkdtempSync(join(temporaryRoot, "doctor-errors-"));
  try {
    writeHealthyState(root);
    writeFileSync(join(root, "AGENTS.md"), agreement.replace("Arcwell rules", "modified"));
    const ownershipPath = join(root, "arcwell", "ownership.json");
    const ownership = JSON.parse(readFileSync(ownershipPath, "utf8")) as ArcwellOwnership;
    ownership.installedPackageSources.push("npm:unexpected-owner@1.0.0");
    ownership.selectedPackageSources.push("npm:unexpected-owner@1.0.0");
    writeOwnershipAtomic(ownershipPath, ownership);
    const redaction = PACKAGE_CATALOG.find((entry) => entry.capability === "redaction")!.source;
    const packages = userPackages(allSources.filter((source) => source !== redaction));
    const report = await runDoctor({ agentDir: root, piClient: new FakePiClient(packages, "pi 0.83.0") });

    assert.equal(report.exitStatus, 2);
    assert.ok(report.checks.some((check) => check.id === "pi.version" && check.status === "error"));
    assert.ok(report.checks.some((check) => check.id === "ownership" && check.status === "error"));
    assert.ok(report.checks.some((check) => check.id === "agreement" && check.status === "error"));
    assert.ok(report.checks.some((check) => check.id === "protection.redaction" && check.status === "error"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor JSON data uses logical paths and never includes raw home or subprocess output", async () => {
  const root = mkdtempSync(join(temporaryRoot, "doctor-portable-home-"));
  try {
    writeHealthyState(root);
    const client = new FakePiClient(userPackages(allSources), `${root}/secret raw subprocess text`);
    const report = await runDoctor({ agentDir: root, piClient: client });
    const json = JSON.stringify(report);

    assert.equal(json.includes(root), false);
    assert.equal(json.includes("raw subprocess text"), false);
    assert.match(json, /\$PI_CODING_AGENT_DIR\/arcwell\/config\.json/);
    assert.doesNotMatch(json, /auth\.json|credential path|token/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
