import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createIsolatedEnvironment,
  replaceProcessEnvironment,
} from "./package-smoke-helpers.mjs";

const PI_VERSION = "0.84.4";
const DEFAULT_EXTENSION = "dist/extensions/arcwell-protections.js";
const [ref, ...extraArguments] = process.argv.slice(2);
if (!ref || extraArguments.length > 0 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)) {
  throw new Error("Usage: node scripts/git-source-smoke.mjs <ref>");
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = realpathSync(resolve(scriptDirectory, ".."));
const source = `git:github.com/VincenzoImp/arcwell@${ref}`;
const temporaryBase = join(repositoryRoot, ".tmp-tests");
mkdirSync(temporaryBase, { recursive: true });
const scratchRoot = mkdtempSync(join(temporaryBase, "git-source-smoke-"));
let scratchCleaned = false;
function cleanupScratch() {
  if (scratchCleaned) return;
  rmSync(scratchRoot, { recursive: true, force: true });
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

// Keep only package-smoke's non-secret environment allowlist. The empty home,
// npm config, and Git config prevent checkout credentials or user helpers from
// crossing into this public, non-interactive transport probe.
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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: isolatedEnvironment,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Git-source smoke command failed with exit ${result.status ?? "unknown"}`);
  }
}

try {
  const localManifest = readJson(join(repositoryRoot, "package.json"));
  assert(localManifest.name === "arcwell", `Expected local package name arcwell, found ${localManifest.name ?? "none"}`);
  assert(typeof localManifest.version === "string", "Local Arcwell package has no version");

  const codingAgentRoot = join(repositoryRoot, "node_modules", "@earendil-works", "pi-coding-agent");
  const codingAgentManifest = readJson(join(codingAgentRoot, "package.json"));
  assert(codingAgentManifest.version === PI_VERSION,
    `Expected repository-local Pi ${PI_VERSION}, found ${codingAgentManifest.version ?? "none"}`);
  const piCli = join(codingAgentRoot, "dist", "bundle", "cli.js");
  assert(existsSync(piCli) && lstatSync(piCli).isFile(), `Repository-local Pi CLI not found: ${piCli}`);

  run(process.execPath, [piCli, "install", source], { cwd: projectDir });

  const codingAgentEntry = join(codingAgentRoot, codingAgentManifest.main);
  const { DefaultPackageManager, DefaultResourceLoader, SettingsManager } = await import(
    pathToFileURL(codingAgentEntry).href
  );
  const settingsManager = SettingsManager.create(projectDir, agentDir, { projectTrusted: false });
  const packageManager = new DefaultPackageManager({ cwd: projectDir, agentDir, settingsManager });
  const installedEntries = packageManager.listConfiguredPackages().filter((entry) =>
    entry.scope === "user" && entry.source === source);
  assert(installedEntries.length === 1,
    `Expected one installed user package for ${source}, found ${installedEntries.length}`);
  assert(typeof installedEntries[0].installedPath === "string",
    `Pi did not report an installed path for ${source}`);
  const installedPath = realpathSync(installedEntries[0].installedPath);
  const relativeToAgent = relative(agentDir, installedPath);
  assert(relativeToAgent !== "" && !relativeToAgent.startsWith("..") && !isAbsolute(relativeToAgent),
    `Installed package path escaped the isolated Pi agent directory: ${installedPath}`);

  const installedManifest = readJson(join(installedPath, "package.json"));
  assert(installedManifest.name === localManifest.name,
    `Expected installed package name ${localManifest.name}, found ${installedManifest.name ?? "none"}`);
  assert(installedManifest.version === localManifest.version,
    `Expected installed package version ${localManifest.version}, found ${installedManifest.version ?? "none"}`);
  assert(installedManifest.pi?.extensions?.includes(`./${DEFAULT_EXTENSION}`),
    `Installed package does not declare the default extension ./${DEFAULT_EXTENSION}`);

  const loader = new DefaultResourceLoader({
    cwd: projectDir,
    agentDir,
    settingsManager,
    noContextFiles: true,
  });
  await loader.reload({ resolveProjectTrust: async () => false });
  const extensions = loader.getExtensions();
  const skills = loader.getSkills();
  const prompts = loader.getPrompts();
  assert(extensions.errors.length === 0,
    `Git-source smoke extension diagnostics: ${JSON.stringify(extensions.errors)}`);
  assert(skills.diagnostics.length === 0 && prompts.diagnostics.length === 0,
    `Git-source smoke resource diagnostics: ${JSON.stringify([
      ...skills.diagnostics,
      ...prompts.diagnostics,
    ])}`);

  const installedExtensions = extensions.extensions.filter((entry) =>
    entry.sourceInfo?.baseDir && realpathSync(entry.sourceInfo.baseDir) === installedPath);
  assert(installedExtensions.length === 1,
    `Expected one default extension from ${installedPath}, found ${installedExtensions.length}`);
  assert(relative(installedPath, realpathSync(installedExtensions[0].resolvedPath)).replaceAll("\\", "/") === DEFAULT_EXTENSION,
    `Default extension did not resolve to ${DEFAULT_EXTENSION}`);
  assert(installedExtensions[0].sourceInfo.source === source,
    `Default extension source did not remain ${source}`);

  console.log(`Git-source transport smoke passed for ${source} (${installedManifest.name}@${installedManifest.version}).`);
} finally {
  try {
    restoreProcessEnvironment();
  } finally {
    cleanupScratch();
  }
}
