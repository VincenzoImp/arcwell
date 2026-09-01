import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createIsolatedEnvironment,
  npmInvocation,
  replaceProcessEnvironment,
} from "./package-smoke-helpers.mjs";

const repositoryRoot = process.cwd();
const scratchRoot = join(repositoryRoot, ".tmp-tests");
mkdirSync(scratchRoot, { recursive: true });
const root = mkdtempSync(join(scratchRoot, "prepare-smoke-"));
const checkout = join(root, "checkout");
const home = join(root, "home");
const agentDir = join(root, "agent");
const npmCache = join(root, "npm-cache");
const npmConfig = join(root, "config", "npmrc");
const project = join(root, "project");
const excludedTopLevel = new Set([".git", ".npm-cache", ".tmp-tests", "dist", "node_modules"]);

function assertRegularFile(path, label) {
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(`Prepare smoke did not build ${label}: ${path}`);
  }
}

function assertDirectory(path, label) {
  if (!existsSync(path) || !lstatSync(path).isDirectory()) {
    throw new Error(`Prepare smoke did not create ${label}: ${path}`);
  }
}

try {
  mkdirSync(checkout);
  for (const entry of readdirSync(repositoryRoot, { withFileTypes: true })) {
    if (excludedTopLevel.has(entry.name)) continue;
    cpSync(join(repositoryRoot, entry.name), join(checkout, entry.name), { recursive: true });
  }
  if (existsSync(join(checkout, "dist")) || existsSync(join(checkout, "node_modules"))) {
    throw new Error("Prepare smoke checkout was not clean");
  }

  mkdirSync(home, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(npmCache, { recursive: true });
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(npmConfig, "", { mode: 0o600 });
  const environment = createIsolatedEnvironment(process.env, {
    home,
    agentDir,
    npmCache,
    npmConfig,
  });
  const npm = npmInvocation();
  const result = spawnSync(npm.command, [
    ...npm.args,
    "install",
    "--omit=dev",
    "--no-audit",
    "--no-fund",
  ], {
    cwd: checkout,
    encoding: "utf8",
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`clean checkout npm install --omit=dev failed with exit ${result.status ?? "unknown"}`);
  }

  const manifest = JSON.parse(readFileSync(join(checkout, "package.json"), "utf8"));
  const binTarget = typeof manifest.bin === "object" ? manifest.bin?.arcwell : undefined;
  if (typeof binTarget !== "string") throw new Error("Prepare smoke found no Arcwell bin target");
  assertDirectory(join(checkout, "dist"), "the dist directory");
  assertRegularFile(join(checkout, binTarget), "the Arcwell bin");
  assertRegularFile(join(checkout, "dist", "extensions", "arcwell-protections.js"), "the Pi extension");
  assertRegularFile(join(checkout, "content", "AGENTS.md"), "the working-agreement resource");
  assertRegularFile(join(checkout, "skills", "code-review", "SKILL.md"), "the code-review skill");
  assertRegularFile(join(checkout, "prompts", "implement.md"), "the implement prompt");

  const codingAgentRoot = join(checkout, "node_modules", "@earendil-works", "pi-coding-agent");
  const codingAgentManifest = JSON.parse(readFileSync(join(codingAgentRoot, "package.json"), "utf8"));
  if (typeof codingAgentManifest.main !== "string") {
    throw new Error("Prepare smoke found no Pi coding-agent module entry");
  }
  const codingAgentEntry = join(codingAgentRoot, codingAgentManifest.main);
  assertRegularFile(codingAgentEntry, "the Pi coding-agent module entry");
  const { DefaultResourceLoader, SettingsManager } = await import(pathToFileURL(codingAgentEntry).href);
  const restoreEnvironment = replaceProcessEnvironment(environment);
  try {
    const loader = new DefaultResourceLoader({
      cwd: project,
      agentDir,
      settingsManager: SettingsManager.inMemory({ packages: [checkout] }, { projectTrusted: false }),
      noContextFiles: true,
    });
    await loader.reload({ resolveProjectTrust: async () => false });
    const extensions = loader.getExtensions();
    const skills = loader.getSkills();
    const prompts = loader.getPrompts();
    if (extensions.errors.length > 0) {
      throw new Error(`Prepare smoke extension diagnostics: ${JSON.stringify(extensions.errors)}`);
    }
    if (skills.diagnostics.length > 0 || prompts.diagnostics.length > 0) {
      throw new Error(`Prepare smoke resource diagnostics: ${JSON.stringify([
        ...skills.diagnostics,
        ...prompts.diagnostics,
      ])}`);
    }
    const fromCheckout = (entry) => entry.sourceInfo?.baseDir === checkout;
    if (extensions.extensions.filter(fromCheckout).length !== 1) {
      throw new Error("Prepare smoke did not load exactly one Arcwell extension");
    }
    if (skills.skills.filter(fromCheckout).length !== 2) {
      throw new Error("Prepare smoke did not load exactly two Arcwell skills");
    }
    if (prompts.prompts.filter(fromCheckout).length !== 3) {
      throw new Error("Prepare smoke did not load exactly three Arcwell prompts");
    }
  } finally {
    restoreEnvironment();
  }

  console.log("Clean copied checkout passed npm install --omit=dev, prepare build, and DefaultResourceLoader smoke.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
