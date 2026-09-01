import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { applySetup } from "../src/setup/apply.js";
import { createDefaultManifest } from "../src/setup/manifest.js";
import { ARCWELL_PACKAGE_SOURCE } from "../src/setup/package-source.js";
import { createSetupPlan } from "../src/setup/plan.js";
import type { PiClient, PiPackage } from "../src/setup/pi-client.js";
import { fixtureInstalledPath, fixturePiPackage } from "./setup-package-fixture.js";

const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });
const agreement = "<!-- arcwell:start -->\nArcwell rules\n<!-- arcwell:end -->\n";
const arcwellSource = ARCWELL_PACKAGE_SOURCE;
const mcpSource = "npm:@spences10/pi-mcp@0.0.60";
const withoutMcp = (): ReturnType<typeof createDefaultManifest> => {
  const manifest = createDefaultManifest();
  manifest.modules.mcp = false;
  return manifest;
};

function desiredSources(manifest = createDefaultManifest()): string[] {
  return createSetupPlan(manifest).operations.flatMap((operation) =>
    operation.kind === "install-package" && operation.source ? [operation.source] : []);
}

class FakePiClient implements PiClient {
  readonly installed: PiPackage[];
  readonly installs: string[] = [];
  readonly removals: string[] = [];

  constructor(sources: string[] = []) {
    this.installed = sources.map((source) => fixturePiPackage(source));
  }

  async version(): Promise<string> { return "pi 0.84.4"; }
  async list(): Promise<PiPackage[]> { return this.installed.map((item) => ({ ...item })); }
  async install(source: string): Promise<void> {
    this.installs.push(source);
    this.installed.push(fixturePiPackage(source));
  }
  async remove(source: string): Promise<void> {
    this.removals.push(source);
    const index = this.installed.findIndex((item) => item.source === source);
    if (index >= 0) this.installed.splice(index, 1);
  }
}

test("apply preflights npm identity conflicts before mutation", async () => {
  const root = mkdtempSync(join(temporaryRoot, "apply-conflict-"));
  try {
    const client = new FakePiClient(["npm:@spences10/pi-lsp@0.0.45"]);
    await assert.rejects(applySetup(createDefaultManifest(), {
      agentDir: root,
      piClient: client,
      workingAgreement: agreement,
    }), /package identity conflict.*@spences10\/pi-lsp/);
    assert.deepEqual(client.installs, []);
    assert.deepEqual(client.removals, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("apply rejects another ref of the Arcwell Git repository before mutation", async () => {
  const root = mkdtempSync(join(temporaryRoot, "apply-git-ref-conflict-"));
  try {
    const client = new FakePiClient(["git:https://github.com/VincenzoImp/arcwell@main"]);
    await assert.rejects(applySetup(createDefaultManifest(), {
      agentDir: root,
      piClient: client,
      workingAgreement: agreement,
    }), /package identity conflict.*github\.com\/VincenzoImp\/arcwell/);
    assert.deepEqual(client.installs, []);
    assert.deepEqual(client.removals, []);
    assert.equal(existsSync(join(root, "AGENTS.md")), false);
    assert.equal(existsSync(join(root, "arcwell")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("apply accepts a same-ref semantic Arcwell Git source without installing or owning it", async () => {
  const root = mkdtempSync(join(temporaryRoot, "apply-equivalent-git-"));
  try {
    const preexisting = "https://github.com/VincenzoImp/arcwell@v0.3.2";
    const client = new FakePiClient([preexisting]);
    client.installed[0]!.installedPath = fixtureInstalledPath(ARCWELL_PACKAGE_SOURCE);
    const ownership = await applySetup(createDefaultManifest(), {
      agentDir: root,
      piClient: client,
      workingAgreement: agreement,
    });
    assert.equal(client.installs.includes(ARCWELL_PACKAGE_SOURCE), false);
    assert.equal(ownership.installedPackageSources.includes(ARCWELL_PACKAGE_SOURCE), false);
    assert.equal(ownership.installedPackageSources.includes(preexisting), false);
    assert.deepEqual(client.removals, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("apply refuses an active unowned catalog package that the manifest deselects before mutation", async () => {
  const root = mkdtempSync(join(temporaryRoot, "apply-unowned-deselected-"));
  try {
    const client = new FakePiClient([mcpSource]);
    await assert.rejects(applySetup(withoutMcp(), {
      agentDir: root,
      piClient: client,
      workingAgreement: agreement,
    }), /unowned.*pi-mcp.*deselected/i);
    assert.deepEqual(client.installs, []);
    assert.deepEqual(client.removals, []);
    assert.equal(existsSync(join(root, "AGENTS.md")), false);
    assert.equal(existsSync(join(root, "arcwell")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("apply installs globally when only the project package is present", async () => {
  const root = mkdtempSync(join(temporaryRoot, "apply-project-package-"));
  try {
    const sources = desiredSources();
    const client = new FakePiClient(sources);
    client.installed.find((item) => item.source === arcwellSource)!.scope = "project";
    const ownership = await applySetup(createDefaultManifest(), {
      agentDir: root,
      piClient: client,
      workingAgreement: agreement,
    });
    assert.deepEqual(client.installs, [arcwellSource]);
    assert.equal(ownership.installedPackageSources.includes(arcwellSource), true);
    assert.deepEqual(ownership.selectedPackageSources, sources);
    assert.equal(ownership.workingAgreementExisted, false);
    assert.equal(ownership.workingAgreementEndedWithNewline, false);
    assert.ok(client.installed.some((item) => item.source === arcwellSource && item.scope === "user"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("apply health rejects Arcwell package metadata that does not match the selected source", async () => {
  const root = mkdtempSync(join(temporaryRoot, "apply-package-metadata-"));
  try {
    const packageRoot = join(root, "installed-arcwell");
    mkdirSync(join(packageRoot, "dist", "extensions"), { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "arcwell", version: "9.9.9", type: "module" }));
    writeFileSync(join(packageRoot, "dist", "extensions", "arcwell-protections.js"), "export default function () {}\n");
    const client = new FakePiClient(desiredSources());
    const installedArcwell = client.installed.find((item) => item.source === arcwellSource)! as PiPackage & { installedPath: string };
    installedArcwell.installedPath = packageRoot;

    await assert.rejects(applySetup(createDefaultManifest(), {
      agentDir: root,
      piClient: client,
      workingAgreement: agreement,
    }), /health check.*Arcwell package.*name\/version/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("apply health syntax-loads the Arcwell protection extension without registering it", async () => {
  const root = mkdtempSync(join(temporaryRoot, "apply-package-syntax-"));
  try {
    const packageRoot = join(root, "installed-arcwell");
    mkdirSync(join(packageRoot, "dist", "extensions"), { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
      name: "arcwell",
      version: "0.3.2",
      type: "module",
      pi: { extensions: ["./dist/extensions/arcwell-protections.js"] },
    }));
    writeFileSync(join(packageRoot, "dist", "extensions", "arcwell-protections.js"), "export default (\n");
    const client = new FakePiClient(desiredSources());
    const installedArcwell = client.installed.find((item) => item.source === arcwellSource)! as PiPackage & { installedPath: string };
    installedArcwell.installedPath = packageRoot;

    await assert.rejects(applySetup(createDefaultManifest(), {
      agentDir: root,
      piClient: client,
      workingAgreement: agreement,
    }), /health check.*Arcwell package.*load/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("apply removes a package when Pi persists it before reporting install failure", async () => {
  const root = mkdtempSync(join(temporaryRoot, "apply-partial-install-"));
  try {
    const client = new FakePiClient();
    client.install = async (source: string) => {
      client.installs.push(source);
      client.installed.push(fixturePiPackage(source));
      throw new Error("Pi failed after persistence");
    };
    await assert.rejects(applySetup(createDefaultManifest(), {
      agentDir: root,
      piClient: client,
      workingAgreement: agreement,
    }), /Pi failed after persistence/);
    assert.deepEqual(client.installed, []);
    assert.deepEqual(client.removals, [ARCWELL_PACKAGE_SOURCE]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("apply attempts cleanup when a failed install is absent from Pi's next list", async () => {
  const root = mkdtempSync(join(temporaryRoot, "apply-ambiguous-install-"));
  try {
    const client = new FakePiClient();
    client.install = async (source: string) => {
      client.installs.push(source);
      throw new Error("ambiguous install failure");
    };
    await assert.rejects(applySetup(createDefaultManifest(), {
      agentDir: root,
      piClient: client,
      workingAgreement: agreement,
    }), /ambiguous install failure/);
    assert.deepEqual(client.removals, [arcwellSource]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reconfiguration removes packages Arcwell owned but no longer selects", async () => {
  const root = mkdtempSync(join(temporaryRoot, "apply-deselect-"));
  try {
    const enabled = createDefaultManifest();
    const client = new FakePiClient();
    await applySetup(enabled, { agentDir: root, piClient: client, workingAgreement: agreement });
    client.installs.length = 0;
    client.removals.length = 0;

    const ownership = await applySetup(withoutMcp(), {
      agentDir: root,
      piClient: client,
      workingAgreement: agreement,
    });
    assert.deepEqual(client.removals, [mcpSource]);
    assert.equal(client.installed.some((item) => item.source === mcpSource && item.scope === "user"), false);
    assert.equal(ownership.installedPackageSources.includes(mcpSource), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reconfiguration restores a removed prior package when a later health check fails", async () => {
  const root = mkdtempSync(join(temporaryRoot, "apply-restore-deselected-"));
  try {
    const enabled = createDefaultManifest();
    const client = new FakePiClient();
    await applySetup(enabled, { agentDir: root, piClient: client, workingAgreement: agreement });
    client.installs.length = 0;
    client.removals.length = 0;
    let lists = 0;
    client.list = async () => {
      lists += 1;
      const installed = client.installed.map((item) => ({ ...item }));
      return lists === 2 ? installed.filter((item) => item.source !== arcwellSource) : installed;
    };

    await assert.rejects(applySetup(withoutMcp(), {
      agentDir: root,
      piClient: client,
      workingAgreement: agreement,
    }), /setup health check: missing package/);
    assert.deepEqual(client.removals, [mcpSource]);
    assert.deepEqual(client.installs, [mcpSource]);
    assert.ok(client.installed.some((item) => item.source === mcpSource && item.scope === "user"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reconfiguration does not remove deselected packages before config succeeds", async () => {
  const root = mkdtempSync(join(temporaryRoot, "apply-config-before-remove-"));
  try {
    const enabled = createDefaultManifest();
    const client = new FakePiClient();
    await applySetup(enabled, { agentDir: root, piClient: client, workingAgreement: agreement });
    client.installs.length = 0;
    client.removals.length = 0;

    await assert.rejects(applySetup(withoutMcp(), {
      agentDir: root,
      piClient: client,
      workingAgreement: agreement,
      writeRuntimeConfig: () => { throw new Error("injected config failure"); },
    }), /injected config failure/);
    assert.deepEqual(client.removals, []);
    assert.ok(client.installed.some((item) => item.source === mcpSource && item.scope === "user"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reconfiguration preserves original working agreement metadata", async () => {
  const root = mkdtempSync(join(temporaryRoot, "apply-original-agreement-metadata-"));
  try {
    const agents = join(root, "AGENTS.md");
    writeFileSync(agents, "original without newline");
    const client = new FakePiClient();
    const first = await applySetup(createDefaultManifest(), {
      agentDir: root,
      piClient: client,
      workingAgreement: agreement,
    });
    const second = await applySetup(createDefaultManifest(), {
      agentDir: root,
      piClient: client,
      workingAgreement: agreement,
    });

    assert.equal(first.workingAgreementExisted, true);
    assert.equal(first.workingAgreementEndedWithNewline, false);
    assert.equal(second.workingAgreementExisted, true);
    assert.equal(second.workingAgreementEndedWithNewline, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed fresh setup removes the Arcwell state directory it created", async () => {
  const root = mkdtempSync(join(temporaryRoot, "apply-created-directory-"));
  try {
    const client = new FakePiClient();
    let lists = 0;
    client.list = async () => {
      lists += 1;
      const installed = client.installed.map((item) => ({ ...item }));
      return lists === 2 ? installed.filter((item) => item.source !== arcwellSource) : installed;
    };

    await assert.rejects(applySetup(createDefaultManifest(), {
      agentDir: root,
      piClient: client,
      workingAgreement: agreement,
    }), /setup health check: missing package/);

    assert.equal(existsSync(join(root, "AGENTS.md")), false);
    assert.equal(existsSync(join(root, "arcwell")), false);
    assert.deepEqual(client.installed, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("apply compensates only invocation changes after a failure", async () => {
  const root = mkdtempSync(join(temporaryRoot, "apply-compensate-"));
  try {
    const agents = join(root, "AGENTS.md");
    writeFileSync(agents, "unrelated\n");
    const preexisting = ARCWELL_PACKAGE_SOURCE;
    const client = new FakePiClient([preexisting]);
    await assert.rejects(applySetup(createDefaultManifest(), {
      agentDir: root,
      piClient: client,
      workingAgreement: agreement,
      writeRuntimeConfig: () => { throw new Error("injected config failure"); },
    }), /injected config failure/);

    assert.equal(readFileSync(agents, "utf8"), "unrelated\n");
    assert.equal(client.removals.includes(preexisting), false);
    assert.deepEqual(new Set(client.removals), new Set(client.installs));
    assert.deepEqual(client.installed.map((item) => item.source), [preexisting]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("managed resources are installed, recorded, and compensated on failure", async () => {
  const root = mkdtempSync(join(temporaryRoot, "apply-managed-resources-"));
  try {
    const managedResources = [
      { path: "agents/scout.md", content: "---\nname: scout\n---\nrecon\n" },
      { path: "presets.json", content: '{"presets":{}}\n' },
    ];
    const ownership = await applySetup(createDefaultManifest(), {
      agentDir: root,
      piClient: new FakePiClient(),
      workingAgreement: agreement,
      managedResources,
    });

    // A nested path and a root path, so directory creation and later pruning are both covered.
    assert.equal(readFileSync(join(root, "agents", "scout.md"), "utf8"), managedResources[0]!.content);
    assert.equal(readFileSync(join(root, "presets.json"), "utf8"), managedResources[1]!.content);
    assert.deepEqual(ownership.installedResources.map((entry) => entry.path), ["agents/scout.md", "presets.json"]);
    assert.deepEqual(ownership.installedResources.map((entry) => entry.existedBefore), [false, false]);

    const failing = mkdtempSync(join(temporaryRoot, "apply-managed-compensate-"));
    try {
      await assert.rejects(applySetup(createDefaultManifest(), {
        agentDir: failing,
        piClient: new FakePiClient(),
        workingAgreement: agreement,
        managedResources,
        writeRuntimeConfig: () => { throw new Error("injected config failure"); },
      }), /injected config failure/);
      assert.equal(existsSync(join(failing, "agents", "scout.md")), false, "compensation removes what it created");
      assert.equal(existsSync(join(failing, "presets.json")), false);
    } finally {
      rmSync(failing, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
