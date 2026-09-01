import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { handleSetupCommand } from "../src/setup/cli.js";
import { handleDoctorCommand } from "../src/setup/doctor.js";
import { createDefaultManifest, parseManifestJson } from "../src/setup/manifest.js";
import { ARCWELL_PACKAGE_SOURCE } from "../src/setup/package-source.js";
import { handleUninstallCommand } from "../src/setup/uninstall.js";

const here = dirname(fileURLToPath(import.meta.url));
const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });

const cli = join(here, "..", "src", "cli.js");

test("public help exposes the lifecycle commands and rejects the retired ones", () => {
  const help = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.match(help, /arcwell setup/);
  assert.match(help, /arcwell doctor/);
  assert.match(help, /arcwell uninstall/);
  assert.doesNotMatch(help, /experimental/);

  // The experimental namespace and its commands were removed with the workflow layer;
  // each must now fail as unknown rather than resolve to anything.
  for (const retired of ["experimental", "init", "plan", "capabilities", "schema", "workflows"]) {
    const attempt = spawnSync(process.execPath, [cli, retired], { encoding: "utf8" });
    assert.equal(attempt.status, 2, `${retired} must not resolve to a command`);
    assert.match(attempt.stderr, new RegExp(`unknown command: ${retired}`));
  }
});

test("setup --dry-run is deterministic and writes nothing", () => {
  const root = mkdtempSync(join(temporaryRoot, "setup-dry-run-"));
  try {
    const home = join(root, "home");
    mkdirSync(home);
    const before = readdirSync(root);
    const env = { ...process.env, HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: join(home, ".pi", "agent") };
    const first = execFileSync(process.execPath, [cli, "setup", "--dry-run"], { cwd: root, encoding: "utf8", env });
    const second = execFileSync(process.execPath, [cli, "setup", "--dry-run"], { cwd: root, encoding: "utf8", env });
    assert.equal(first, second);
    assert.ok(first.includes(ARCWELL_PACKAGE_SOURCE));
    assert.match(first, /\$PI_CODING_AGENT_DIR\/arcwell\/config\.json/);
    assert.deepEqual(readdirSync(root), before);
    assert.deepEqual(readdirSync(home), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("TTY dry run without a manifest collects choices without apply confirmation and writes the selected manifest", async () => {
  const root = mkdtempSync(join(temporaryRoot, "setup-tty-dry-run-"));
  try {
    const outputPath = join(root, "arcwell.json");
    const prompts: string[] = [];
    const answers = ["host", "", ""];
    let applied = false;
    const stdout: string[] = [];

    assert.equal(await handleSetupCommand(["setup", "--dry-run", "--write-manifest", outputPath], {
      stdout: (text) => stdout.push(text),
      stderr: () => undefined,
    }, {
      isTTY: true,
      wizardIo: {
        question: async (prompt) => { prompts.push(prompt); return answers.shift(); },
        write: (text) => stdout.push(text),
      },
      apply: async () => { applied = true; },
    }), true);

    const manifest = parseManifestJson(readFileSync(outputPath, "utf8"));
    assert.equal(manifest.posture, "host");
    assert.deepEqual(manifest.protections, { effects: false, secrets: false, redaction: false });
    assert.equal(prompts.some((prompt) => /Apply this exact plan/i.test(prompt)), false);
    assert.equal(applied, false);
    assert.match(stdout.join(""), /Arcwell setup dry run/);
    assert.match(stdout.join(""), /"posture": "host"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup --write-manifest writes only the requested portable manifest", () => {
  const root = mkdtempSync(join(temporaryRoot, "setup-manifest-"));
  try {
    const output = join(root, "arcwell.json");
    execFileSync(process.execPath, [cli, "setup", "--dry-run", "--write-manifest", output], {
      cwd: root,
      encoding: "utf8",
    });
    const manifest = parseManifestJson(readFileSync(output, "utf8"));
    assert.equal(manifest.profile, "core");
    assert.deepEqual(readdirSync(root), ["arcwell.json"]);
    assert.equal(readFileSync(output, "utf8").includes(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup --manifest --yes invokes injected apply without resolving real Pi state", async () => {
  const root = mkdtempSync(join(temporaryRoot, "setup-apply-cli-"));
  try {
    const manifestPath = join(root, "arcwell.json");
    execFileSync(process.execPath, [cli, "setup", "--write-manifest", manifestPath], { encoding: "utf8" });
    const calls: string[] = [];
    const output: string[] = [];
    assert.equal(await handleSetupCommand(["setup", "--manifest", manifestPath, "--yes"], {
      stdout: (text) => output.push(text),
      stderr: () => undefined,
    }, {
      isTTY: false,
      apply: async (manifest) => { calls.push(manifest.arcwellVersion); },
    }), true);
    assert.deepEqual(calls, ["0.1.0"]);
    assert.match(output.join(""), /setup complete/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("non-TTY setup mutation requires both --manifest and --yes before injected apply", async () => {
  const root = mkdtempSync(join(temporaryRoot, "setup-non-tty-"));
  try {
    const manifestPath = join(root, "arcwell.json");
    writeFileSync(manifestPath, JSON.stringify(createDefaultManifest()));
    for (const argv of [
      ["setup"],
      ["setup", "--yes"],
      ["setup", "--manifest", manifestPath],
    ]) {
      let called = false;
      await assert.rejects(handleSetupCommand(argv, {
        stdout: () => undefined,
        stderr: () => undefined,
      }, {
        isTTY: false,
        apply: async () => { called = true; },
      }), /non-TTY.*--manifest.*--yes/);
      assert.equal(called, false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("interactive setup applies the generated defaults only after explicit confirmation", async () => {
  let applied: ReturnType<typeof createDefaultManifest> | undefined;
  const answers = ["", "", "", "", "", "yes"];
  assert.equal(await handleSetupCommand(["setup"], {
    stdout: () => undefined,
    stderr: () => undefined,
  }, {
    isTTY: true,
    wizardIo: {
      question: async () => answers.shift(),
      write: () => undefined,
    },
    apply: async (manifest) => { applied = manifest; },
  }), true);
  assert.deepEqual(applied, createDefaultManifest());
});

test("interactive setup never applies before the rendered plan is explicitly confirmed", async () => {
  let applied = false;
  const output: string[] = [];
  const answers = ["", "", "", "", "", "no"];
  assert.equal(await handleSetupCommand(["setup"], {
    stdout: (text) => output.push(text),
    stderr: () => undefined,
  }, {
    isTTY: true,
    wizardIo: {
      question: async (prompt) => {
        if (/Apply this exact plan/i.test(prompt)) {
          assert.equal(applied, false);
          assert.ok(output.join("").includes(ARCWELL_PACKAGE_SOURCE));
        }
        return answers.shift();
      },
      write: (text) => output.push(text),
    },
    apply: async () => { applied = true; },
  }), true);
  assert.equal(applied, false);
  assert.match(output.join(""), /setup canceled/i);
});

test("doctor --json emits one portable report and returns its health exit status", async () => {
  const stdout: string[] = [];
  const status = await handleDoctorCommand(["doctor", "--json"], {
    stdout: (text) => stdout.push(text),
    stderr: () => undefined,
  }, {
    run: async () => ({
      schemaVersion: 1,
      status: "warnings",
      exitStatus: 1,
      checks: [{ id: "module.web", status: "warning", message: "Module web is disabled", path: "$PI_CODING_AGENT_DIR/arcwell/config.json" }],
      guidance: ["Claude subscription authentication is managed by Pi; use /login if desired."],
    }),
  });

  assert.equal(status, 1);
  assert.equal(JSON.parse(stdout.join("")).exitStatus, 1);
});

test("TTY uninstall requires injected confirmation while --yes skips it", async () => {
  let runs = 0;
  const prompts: string[] = [];
  const io = { stdout: () => undefined, stderr: () => undefined };

  assert.equal(await handleUninstallCommand(["uninstall"], io, {
    isTTY: true,
    confirm: async (prompt) => { prompts.push(prompt); return true; },
    run: async () => { runs += 1; return { removedPackageSources: [] }; },
  }), 0);
  assert.equal(runs, 1);
  assert.match(prompts.join(""), /remove.*Arcwell/i);

  assert.equal(await handleUninstallCommand(["uninstall"], io, {
    isTTY: true,
    confirm: async () => false,
    run: async () => { runs += 1; return { removedPackageSources: [] }; },
  }), 0);
  assert.equal(runs, 1);

  assert.equal(await handleUninstallCommand(["uninstall", "--yes"], io, {
    isTTY: true,
    confirm: async () => { throw new Error("--yes must skip confirmation"); },
    run: async () => { runs += 1; return { removedPackageSources: [] }; },
  }), 0);
  assert.equal(runs, 2);
});

test("non-TTY uninstall requires --yes before injected mutation", async () => {
  let called = false;
  await assert.rejects(handleUninstallCommand(["uninstall"], {
    stdout: () => undefined,
    stderr: () => undefined,
  }, {
    isTTY: false,
    run: async () => { called = true; return { removedPackageSources: [] }; },
  }), /non-TTY.*--yes/);
  assert.equal(called, false);

  const output: string[] = [];
  assert.equal(await handleUninstallCommand(["uninstall", "--yes"], {
    stdout: (text) => output.push(text),
    stderr: () => undefined,
  }, {
    isTTY: false,
    run: async () => ({ removedPackageSources: [ARCWELL_PACKAGE_SOURCE] }),
  }), 0);
  assert.match(output.join(""), /uninstall complete/);
});
