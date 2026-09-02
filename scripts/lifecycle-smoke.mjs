/**
 * The full lifecycle against real Pi: setup, doctor, resource loading, uninstall.
 *
 * Every other level stops short of this one. `setup-scratch.test.ts` runs the same cycle with
 * fake Pi clients, so it proves the logic and not the integration; `pi-package-smoke.mjs`
 * installs real packages but never calls setup. Between them, nothing had ever run
 * `arcwell setup` against a real `pi install` — the thing every user runs first.
 *
 * It needs a ref that exists on the remote, because setup installs Arcwell from
 * ARCWELL_PACKAGE_SOURCE rather than from this checkout.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createIsolatedEnvironment, replaceProcessEnvironment } from "./package-smoke-helpers.mjs";

const PI_VERSION = "0.84.4";
/** Deterministic because every catalog version is pinned exactly: a bump has to be seen. */
const EXPECTED = { extensions: 14, skills: 17, prompts: 11, packages: 7 };
/** Written by setup, and gone again after uninstall. */
const OWNED_PATHS = ["AGENTS.md", "presets.json", "arcwell"];

const [ref, ...extraArguments] = process.argv.slice(2);
if (!ref || extraArguments.length > 0 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)) {
  throw new Error("Usage: node scripts/lifecycle-smoke.mjs <ref>");
}

const repositoryRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const temporaryBase = join(repositoryRoot, ".tmp-tests");
mkdirSync(temporaryBase, { recursive: true });
const scratchRoot = mkdtempSync(join(temporaryBase, "lifecycle-smoke-"));
let scratchCleaned = false;
function cleanupScratch() {
  if (scratchCleaned) return;
  rmSync(scratchRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
  scratchCleaned = true;
}
process.once("exit", cleanupScratch);

const home = join(scratchRoot, "home");
const agentDir = join(scratchRoot, "pi-agent");
const npmCache = join(scratchRoot, "npm-cache");
const npmConfig = join(scratchRoot, "npm-config", "npmrc");
const gitConfig = join(scratchRoot, "git-config");
const projectDir = join(scratchRoot, "project");
for (const directory of [home, agentDir, npmCache, dirname(npmConfig), projectDir]) {
  mkdirSync(directory, { recursive: true });
}
writeFileSync(npmConfig, "", { mode: 0o600 });
writeFileSync(gitConfig, "", { mode: 0o600 });

const isolatedEnvironment = {
  ...createIsolatedEnvironment(process.env, { home, agentDir, npmCache, npmConfig }),
  GIT_CONFIG_GLOBAL: gitConfig,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "Never",
};
const restoreProcessEnvironment = replaceProcessEnvironment(isolatedEnvironment);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** Runs the locally built CLI, which is the code under test; only the package source is remote. */
function arcwell(args, { capture = false } = {}) {
  const result = spawnSync(process.execPath, [join(repositoryRoot, "dist", "src", "cli.js"), ...args], {
    cwd: projectDir,
    env: isolatedEnvironment,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  assert(result.status === 0, `arcwell ${args[0]} exited ${result.status ?? "unknown"}`);
  return result.stdout ?? "";
}

try {
  const { ARCWELL_PACKAGE_SOURCE } = await import(
    pathToFileURL(join(repositoryRoot, "dist", "src", "setup", "package-source.js")).href
  );
  const source = `git:github.com/VincenzoImp/arcwell@${ref}`;
  assert(ARCWELL_PACKAGE_SOURCE === source,
    `This checkout installs ${ARCWELL_PACKAGE_SOURCE}, so testing ${ref} would verify a mismatched pair`);

  const codingAgentRoot = join(repositoryRoot, "node_modules", "@earendil-works", "pi-coding-agent");
  const codingAgentManifest = readJson(join(codingAgentRoot, "package.json"));
  assert(codingAgentManifest.version === PI_VERSION,
    `Expected repository-local Pi ${PI_VERSION}, found ${codingAgentManifest.version ?? "none"}`);

  // A dry run must describe the same plan it later applies, and must not touch the agent
  // directory: the manifest lands in the project, nothing else moves.
  arcwell(["setup", "--dry-run", "--write-manifest", "arcwell.json"]);
  assert(!existsSync(join(agentDir, "AGENTS.md")), "Dry run wrote to the agent directory");
  const manifest = readJson(join(projectDir, "arcwell.json"));
  assert(manifest.arcwellVersion === readJson(join(repositoryRoot, "package.json")).version,
    "Written manifest does not carry this Arcwell version");

  arcwell(["setup", "--manifest", "arcwell.json", "--yes"]);
  // Asserted here as well as after uninstall, so the removal check cannot pass vacuously.
  for (const owned of OWNED_PATHS) {
    assert(existsSync(join(agentDir, owned)), `Setup did not create ${owned}`);
  }

  const report = JSON.parse(arcwell(["doctor", "--json"], { capture: true }));
  // A runner without bwrap/socat/rg is an honest warning about the host, not a defect in the
  // setup this smoke is testing. Everything else must still be ok, and it must be a warning
  // rather than an error, so the allowance cannot hide a real failure.
  const notOk = report.checks.filter((check) =>
    check.status !== "ok" && !(check.id === "sandbox.prerequisites" && check.status === "warning"));
  assert(notOk.length === 0, `Doctor reported ${report.status}: ${JSON.stringify(notOk)}`);

  const settings = readJson(join(agentDir, "settings.json"));
  assert(settings.packages.length === EXPECTED.packages,
    `Expected ${EXPECTED.packages} installed packages, found ${settings.packages.length}`);
  // pi-subagents resolves a git source to <agentDir>/git/<host>/<repo>, so the agents ship with
  // the package rather than being copied to disk. Their absence here is silent at runtime.
  const installedRoot = join(agentDir, "git", "github.com", "VincenzoImp", "arcwell");
  for (const name of ["planner"]) {
    assert(existsSync(join(installedRoot, "agents", `${name}.md`)),
      `Installed package is missing agents/${name}.md, where pi-subagents looks for it`);
  }

  // Every package installed together, which is the only place a tool collision between two of
  // them can appear.
  const { DefaultResourceLoader, SettingsManager } = await import(
    pathToFileURL(join(codingAgentRoot, codingAgentManifest.main)).href
  );
  const settingsManager = SettingsManager.create(projectDir, agentDir, { projectTrusted: false });
  const loader = new DefaultResourceLoader({ cwd: projectDir, agentDir, settingsManager, noContextFiles: true });
  await loader.reload({ resolveProjectTrust: async () => false });
  const [extensions, skills, prompts] = [loader.getExtensions(), loader.getSkills(), loader.getPrompts()];
  const diagnostics = [...extensions.errors, ...skills.diagnostics, ...prompts.diagnostics];
  assert(diagnostics.length === 0, `Resource diagnostics after setup: ${JSON.stringify(diagnostics)}`);
  const counts = {
    extensions: extensions.extensions.length,
    skills: skills.skills.length,
    prompts: prompts.prompts.length,
  };
  for (const kind of ["extensions", "skills", "prompts"]) {
    assert(counts[kind] === EXPECTED[kind], `Expected ${EXPECTED[kind]} ${kind}, found ${counts[kind]}`);
  }

  arcwell(["uninstall", "--yes"]);

  for (const owned of OWNED_PATHS) {
    assert(!existsSync(join(agentDir, owned)), `Uninstall left ${owned} behind`);
  }
  assert(readJson(join(agentDir, "settings.json")).packages.length === 0,
    "Uninstall left package selections in settings.json");

  console.log(
    `Lifecycle smoke passed for ${source}: setup installed ${EXPECTED.packages} packages ` +
    `(${counts.extensions} extensions, ${counts.skills} skills, ${counts.prompts} prompts), ` +
    `doctor reported healthy, uninstall restored the agent directory.`,
  );
} finally {
  try {
    restoreProcessEnvironment();
  } finally {
    cleanupScratch();
  }
}
