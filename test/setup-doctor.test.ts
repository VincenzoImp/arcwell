import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { passesSystemPromptAsFile, runDoctor } from "../src/setup/doctor.js";
import { PACKAGE_CATALOG } from "../src/setup/catalog.js";
import { writeRuntimeConfigAtomic } from "../src/setup/config.js";
import { ARCWELL_VERSION } from "../src/setup/manifest.js";
import { writeOwnershipAtomic, type ArcwellOwnership } from "../src/setup/ownership.js";
import { ARCWELL_PACKAGE_SOURCE } from "../src/setup/package-source.js";
import { assertArcwellPackageHealthy } from "../src/setup/package-health.js";
import type { PiClient, PiPackage } from "../src/setup/pi-client.js";
import type { RuntimeConfig } from "../src/setup/types.js";
import { workingAgreementDigest } from "../src/setup/working-agreement.js";
import { fixtureInstalledPath, fixturePiPackage, writeIntegrityLock } from "./setup-package-fixture.js";

const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });
const agreement = "<!-- arcwell:start -->\nArcwell rules\n<!-- arcwell:end -->\n";
const arcwellSource = ARCWELL_PACKAGE_SOURCE;
// What a default setup actually installs: claudeCli is the one entry that is off unless asked
// for, so including it here would make every fixture an unrealistic environment.
const allSources = [arcwellSource, ...PACKAGE_CATALOG.filter((entry) => entry.defaultEnabled).map((entry) => entry.source)];
const claudeCliSource = PACKAGE_CATALOG.find((entry) => entry.capability === "claudeCli")!.source;
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
    subagentOverridesWritten: false,
  };
  writeIntegrityLock(root, selectedSources);
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
    const report = await runDoctor({ agentDir: root, missingBinaries: () => [], piClient: new FakePiClient(userPackages(allSources)) });

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
    const equivalentSource = "git:ssh://git@github.com/VincenzoImp/arcwell@v0.6.2";
    const packages = userPackages(allSources.filter((source) => source !== arcwellSource));
    packages.push({
      ...fixturePiPackage(equivalentSource),
      installedPath: fixtureInstalledPath(ARCWELL_PACKAGE_SOURCE),
    });

    const report = await runDoctor({ agentDir: root, missingBinaries: () => [], piClient: new FakePiClient(packages) });

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
    const report = await runDoctor({ agentDir: root, missingBinaries: () => [], piClient: new FakePiClient(userPackages(enabledSources)) });

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
    // A different ref of the same repository is the conflict this asserts.
    packages.push(fixturePiPackage("git:github.com/VincenzoImp/arcwell@v0.1.0"));
    const report = await runDoctor({ agentDir: root, missingBinaries: () => [], piClient: new FakePiClient(packages) });

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

    const report = await runDoctor({ agentDir: root, missingBinaries: () => [], piClient: new FakePiClient(packages) });

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
      missingBinaries: () => [], piClient: new FakePiClient(userPackages(allSources.filter((source) => source !== lspSource))),
    });

    assert.equal(report.exitStatus, 2);
    assert.ok(report.checks.some((check) => check.id === "package.lsp" && check.status === "error" && /missing/.test(check.message)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor warns on both halves of the Claude billing path", async (t) => {
  const withProvider = (root: string, provider?: string): void => {
    writeFileSync(join(root, "settings.json"), JSON.stringify(provider ? { defaultProvider: provider } : {}));
  };

  await t.test("adapter off while the provider is anthropic", async () => {
    const root = mkdtempSync(join(temporaryRoot, "doctor-claude-off-"));
    try {
      writeHealthyState(root);
      withProvider(root, "anthropic");
      const report = await runDoctor({ agentDir: root, missingBinaries: () => [], piClient: new FakePiClient(userPackages(allSources)) });
      assert.ok(report.checks.some((check) =>
        check.id === "provider.claudeCli" && check.status === "warning" && /billed per token/.test(check.message)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // The half that bit first: installing it changes nothing until the provider points at it.
  await t.test("adapter installed but never selected", async () => {
    const root = mkdtempSync(join(temporaryRoot, "doctor-claude-unselected-"));
    try {
      const withAdapter = [...allSources, claudeCliSource];
      writeHealthyState(root, withAdapter);
      withProvider(root, undefined);
      const report = await runDoctor({ agentDir: root, missingBinaries: () => [], piClient: new FakePiClient(userPackages(withAdapter)) });
      assert.ok(report.checks.some((check) =>
        check.id === "provider.claudeCli" && check.status === "warning" && /defaultProvider is unset/.test(check.message)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("adapter installed and selected is silent", async () => {
    const root = mkdtempSync(join(temporaryRoot, "doctor-claude-selected-"));
    try {
      const withAdapter = [...allSources, claudeCliSource];
      writeHealthyState(root, withAdapter);
      withProvider(root, "pi-claude-cli");
      const report = await runDoctor({ agentDir: root, missingBinaries: () => [], piClient: new FakePiClient(userPackages(withAdapter)) });
      assert.equal(report.checks.some((check) => check.id === "provider.claudeCli"), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// Arcwell cannot fix another package. It can refuse to let the failure stay invisible: passing
// a path to --append-system-prompt replaces the agreement and every skill with that path, and
// the CLI has nothing to complain about because a path is valid text.
// Every other doctor test injects a satisfied host so its assertions are about Arcwell. This
// one is the opposite: it exists so making that injection did not quietly delete the check.
// Linux-only, because that is the only platform where the sandbox has host prerequisites.
test("a host missing the sandbox binaries is a warning, never a failure", {
  skip: process.platform !== "linux",
}, async () => {
  const root = mkdtempSync(join(temporaryRoot, "doctor-sandbox-prereq-"));
  try {
    writeHealthyState(root);
    const report = await runDoctor({
      agentDir: root,
      piClient: new FakePiClient(userPackages(allSources)),
      missingBinaries: () => ["bwrap", "socat"],
    });

    assert.equal(report.exitStatus, 1);
    const check = report.checks.find((entry) => entry.id === "sandbox.prerequisites");
    assert.equal(check?.status, "warning");
    assert.match(check?.message ?? "", /bwrap, socat/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor reads the Claude adapter's own source for the flag that decides the system prompt", async (t) => {
  const write = (root: string, line: string): string => {
    const packageRoot = join(root, "adapter");
    mkdirSync(join(packageRoot, "src"), { recursive: true });
    writeFileSync(join(packageRoot, "src", "process-manager.ts"), `args.push(${line}, tmpFile);\n`);
    return packageRoot;
  };

  await t.test("a path handed to the literal-text flag is an error", async () => {
    const root = mkdtempSync(join(temporaryRoot, "doctor-claude-flag-bad-"));
    try {
      const withAdapter = [...allSources, claudeCliSource];
      writeHealthyState(root, withAdapter);
      const packages = userPackages(withAdapter);
      (packages.find((item) => item.source === claudeCliSource)! as PiPackage & { installedPath: string })
        .installedPath = write(root, '"--append-system-prompt"');

      const report = await runDoctor({ agentDir: root, missingBinaries: () => [], piClient: new FakePiClient(packages) });
      assert.equal(report.exitStatus, 2);
      assert.ok(report.checks.some((check) =>
        check.id === "package.claudeCli.systemPrompt" && check.status === "error"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("the file flag is accepted, and an unreadable adapter is not a finding", () => {
    const root = mkdtempSync(join(temporaryRoot, "doctor-claude-flag-good-"));
    try {
      assert.equal(passesSystemPromptAsFile(write(root, '"--append-system-prompt-file"')), true);
      assert.equal(passesSystemPromptAsFile(join(root, "does-not-exist")), undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test("doctor separates bytes that differ from bytes it cannot read", async (t) => {
  await t.test("a substituted artifact is an error, and names the package", async () => {
    const root = mkdtempSync(join(temporaryRoot, "doctor-integrity-bad-"));
    try {
      writeHealthyState(root);
      writeIntegrityLock(root, allSources, PACKAGE_CATALOG.find((e) => e.capability === "mcp")!.source);
      const report = await runDoctor({ agentDir: root, missingBinaries: () => [], piClient: new FakePiClient(userPackages(allSources)) });

      assert.equal(report.exitStatus, 2);
      assert.ok(report.checks.some((check) =>
        check.id === "integrity" && check.status === "error" && /pi-mcp/.test(check.message)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Not knowing is not the same as tampering, and reporting it as an error would train the
  // reader to ignore the check on any machine npm has not written a lock file for yet.
  await t.test("an unreadable lock file is a warning, not an error", async () => {
    const root = mkdtempSync(join(temporaryRoot, "doctor-integrity-none-"));
    try {
      writeHealthyState(root);
      rmSync(join(root, "npm", "node_modules", ".package-lock.json"), { force: true });
      const report = await runDoctor({ agentDir: root, missingBinaries: () => [], piClient: new FakePiClient(userPackages(allSources)) });

      assert.equal(report.exitStatus, 1);
      assert.ok(report.checks.some((check) => check.id === "integrity" && check.status === "warning"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test("doctor reports a Pi that resolves to one version outside the package and another inside", async () => {
  const root = mkdtempSync(join(temporaryRoot, "doctor-nested-pi-"));
  try {
    writeHealthyState(root);
    const packageRoot = join(root, "installed-arcwell");
    mkdirSync(join(packageRoot, "dist", "extensions"), { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify(healthyArcwellPackageJson));
    writeFileSync(join(packageRoot, "dist", "extensions", "arcwell-protections.js"), "export default function () {}\n");
    // What npm produces for a peer range: the agent runs one Pi, the extensions import another.
    const nested = join(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.85.0" }));
    const packages = userPackages(allSources);
    (packages.find((item) => item.source === arcwellSource)! as PiPackage & { installedPath: string }).installedPath = packageRoot;

    const report = await runDoctor({ agentDir: root, missingBinaries: () => [], piClient: new FakePiClient(packages) });
    assert.equal(report.exitStatus, 2);
    assert.ok(report.checks.some((check) =>
      check.id === "pi.nested" && check.status === "error" && /0\.84\.4.*0\.85\.0/.test(check.message)));
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

      const report = await runDoctor({ agentDir: root, missingBinaries: () => [], piClient: new FakePiClient(packages) });
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

      const report = await runDoctor({ agentDir: root, missingBinaries: () => [], piClient: new FakePiClient(packages) });
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

      const report = await runDoctor({ agentDir: root, missingBinaries: () => [], piClient: new FakePiClient(packages) });
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

      const report = await runDoctor({ agentDir: root, missingBinaries: () => [], piClient: new FakePiClient(packages) });
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
    const report = await runDoctor({ agentDir: root, missingBinaries: () => [], piClient: new FakePiClient(userPackages([...selected, mcpSource])) });

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
    const report = await runDoctor({ agentDir: root, missingBinaries: () => [], piClient: new FakePiClient(packages, "pi 0.83.0") });

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
