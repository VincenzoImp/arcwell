import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createIsolatedEnvironment,
  findInstallLifecycleScripts,
  npmInvocation,
  replaceProcessEnvironment,
} from "./package-smoke-helpers.mjs";

const PI_VERSION = "0.84.4";
const PI_SETTINGS_EXCEPTION = {
  name: "@spences10/pi-settings",
  version: "0.0.3",
  repositoryFragment: "github.com/spences10/my-pi",
};
const EXPECTED_EXTERNAL_EXTENSIONS = new Map([
  ["npm:@spences10/pi-lsp@0.0.46", "dist/index.js"],
  ["npm:@spences10/pi-context@0.1.16", "dist/index.js"],
  ["npm:@juicesharp/rpiv-todo@2.8.0", "index.ts"],
  ["npm:@juicesharp/rpiv-ask-user-question@2.8.0", "index.ts"],
  ["npm:@narumitw/pi-plan-mode@0.56.0", "dist/index.ts"],
  ["npm:@spences10/pi-mcp@0.0.60", "dist/index.js"],
  ["npm:pi-web-access@0.27.0", "index.ts"],
  ["npm:pi-subagents@0.61.0", "index.ts"],
  ["npm:@narumitw/pi-goal@0.54.4", "dist/index.ts"],
  ["npm:@spences10/pi-redact@0.0.15", "dist/index.js"],
]);

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = realpathSync(resolve(scriptDirectory, ".."));
const temporaryBase = join(repositoryRoot, ".tmp-tests");
mkdirSync(temporaryBase, { recursive: true });
const scratchRoot = mkdtempSync(join(temporaryBase, "pi-package-smoke-"));
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
const projectDir = join(scratchRoot, "project");
for (const directory of [home, agentDir, npmCache, dirname(npmConfig), projectDir]) mkdirSync(directory, { recursive: true });
writeFileSync(npmConfig, "", { mode: 0o600 });

const npm = npmInvocation();
const isolatedEnvironment = createIsolatedEnvironment(process.env, {
  home,
  agentDir,
  npmCache,
  npmConfig,
});
const restoreProcessEnvironment = replaceProcessEnvironment(isolatedEnvironment);

function commandDisplay(command, args) {
  return [command, ...args].map((part) => JSON.stringify(part)).join(" ");
}

function run(command, args, options = {}) {
  console.log(`\n> ${commandDisplay(command, args)}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: isolatedEnvironment,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = options.capture ? `\n${result.stdout ?? ""}${result.stderr ?? ""}` : "";
    throw new Error(`Command failed (${result.status}): ${commandDisplay(command, args)}${details}`);
  }
  return result.stdout ?? "";
}

function normalizeRelative(baseDir, path) {
  return relative(baseDir, path).replaceAll("\\", "/");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function packageDirectories(nodeModulesDirectory) {
  if (!existsSync(nodeModulesDirectory)) return [];
  const directories = [];
  for (const entry of readdirSync(nodeModulesDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".bin") continue;
    const entryPath = join(nodeModulesDirectory, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scopedEntry of readdirSync(entryPath, { withFileTypes: true })) {
        if (scopedEntry.isDirectory()) directories.push(join(entryPath, scopedEntry.name));
      }
    } else {
      directories.push(entryPath);
    }
  }
  return directories;
}

function installedPackages(npmRoot) {
  const packages = [];
  const pending = packageDirectories(join(npmRoot, "node_modules"));
  const visited = new Set();
  while (pending.length > 0) {
    const directory = pending.pop();
    const packageJsonPath = join(directory, "package.json");
    if (!existsSync(packageJsonPath)) continue;
    const canonicalPath = realpathSync(packageJsonPath);
    if (visited.has(canonicalPath)) continue;
    visited.add(canonicalPath);
    packages.push({ directory, packageJsonPath, manifest: readJson(packageJsonPath) });
    pending.push(...packageDirectories(join(directory, "node_modules")));
  }
  return packages;
}

function licenseValue(manifest) {
  if (typeof manifest.license === "string" && manifest.license.trim()) return manifest.license.trim();
  if (manifest.license && typeof manifest.license.type === "string") return manifest.license.type.trim();
  if (Array.isArray(manifest.licenses) && manifest.licenses.length > 0) {
    return manifest.licenses.map((entry) => typeof entry === "string" ? entry : entry?.type).filter(Boolean).join(" OR ");
  }
  return undefined;
}

function repositoryUrl(manifest) {
  if (typeof manifest.repository === "string") return manifest.repository;
  return typeof manifest.repository?.url === "string" ? manifest.repository.url : "";
}

function packageLabel(manifest) {
  return `${manifest.name ?? "<unnamed>"}@${manifest.version ?? "<unversioned>"}`;
}

function verifyPiSettingsException(entry, allPackages) {
  const { manifest, directory } = entry;
  assert(manifest.name === PI_SETTINGS_EXCEPTION.name && manifest.version === PI_SETTINGS_EXCEPTION.version,
    `Undocumented missing-license package: ${packageLabel(manifest)}`);

  const licensePath = join(directory, "LICENSE");
  const readmePath = join(directory, "README.md");
  assert(existsSync(licensePath), `${packageLabel(manifest)} is missing its documented MIT LICENSE file`);
  const licenseText = readFileSync(licensePath, "utf8");
  assert(/MIT License/i.test(licenseText) && /Permission is hereby granted, free of charge/i.test(licenseText),
    `${packageLabel(manifest)} LICENSE is not the documented MIT text`);
  assert(existsSync(readmePath) && /Shared settings store for `my-pi`/i.test(readFileSync(readmePath, "utf8")),
    `${packageLabel(manifest)} README does not document my-pi provenance`);

  const provenanceParents = allPackages.filter(({ manifest: candidate }) =>
    candidate.dependencies?.[PI_SETTINGS_EXCEPTION.name] || candidate.optionalDependencies?.[PI_SETTINGS_EXCEPTION.name]);
  assert(provenanceParents.length > 0, `${packageLabel(manifest)} has no installed provenance parent`);
  for (const parent of provenanceParents) {
    assert(repositoryUrl(parent.manifest).includes(PI_SETTINGS_EXCEPTION.repositoryFragment),
      `${packageLabel(manifest)} parent ${packageLabel(parent.manifest)} is not from documented my-pi provenance`);
  }
}

function reportPackageMetadata(npmRoot) {
  const arcwellPackageJson = join(repositoryRoot, "package.json");
  const downloadedPackages = installedPackages(npmRoot);
  const packages = [
    { directory: repositoryRoot, packageJsonPath: arcwellPackageJson, manifest: readJson(arcwellPackageJson) },
    ...downloadedPackages,
  ];
  assert(packages.length > 1, `No installed packages found under ${npmRoot}`);

  const licenseSets = new Map();
  const missingLicense = [];
  for (const entry of packages) {
    const { manifest } = entry;
    assert(typeof manifest.name === "string" && typeof manifest.version === "string",
      `Installed package lacks name/version metadata: ${entry.packageJsonPath}`);
    const license = licenseValue(manifest);
    if (license) {
      if (!licenseSets.has(license)) licenseSets.set(license, []);
      licenseSets.get(license).push(packageLabel(manifest));
    } else {
      missingLicense.push(entry);
    }
  }
  // Arcwell's documented prepare script builds a Git checkout. This rejection is
  // specifically for downloaded third-party packages selected by the smoke.
  const lifecycle = findInstallLifecycleScripts(downloadedPackages);

  console.log(`\nInspected ${packages.length} installed package.json files recursively.`);
  console.log("License sets:");
  for (const [license, labels] of [...licenseSets].sort(([left], [right]) => left.localeCompare(right))) {
    console.log(`  ${license}: ${labels.length} package(s)`);
  }
  console.log("Missing package license metadata:");
  if (missingLicense.length === 0) console.log("  none");
  for (const entry of missingLicense) console.log(`  ${packageLabel(entry.manifest)} (${entry.packageJsonPath})`);
  console.log("Downloaded third-party install lifecycle scripts:");
  if (lifecycle.length === 0) console.log("  none");
  for (const script of lifecycle.toSorted()) console.log(`  ${script}`);

  assert(lifecycle.length === 0, `Downloaded third-party manifests declare lifecycle scripts:\n${lifecycle.join("\n")}`);
  for (const entry of missingLicense) verifyPiSettingsException(entry, packages);
  return packages;
}

function packageNameFromSource(source) {
  const spec = source.slice("npm:".length);
  return spec.slice(0, spec.lastIndexOf("@"));
}

function resourceBelongsToExactRoot(entry, path, expectedRoots) {
  assert(typeof entry.sourceInfo.baseDir === "string", `Resource has no package base directory: ${path}`);
  const baseDir = realpathSync(entry.sourceInfo.baseDir);
  assert(expectedRoots.has(baseDir), `Resource came from an unexpected package root: ${baseDir}`);
  const resourcePath = realpathSync(path);
  const resourceRelativePath = relative(baseDir, resourcePath);
  assert(resourceRelativePath !== "" && !resourceRelativePath.startsWith("..") && !isAbsolute(resourceRelativePath),
    `Resource escapes its expected package root: ${path}`);
}

async function verifyResources(catalogSources, npmRoot) {
  const { DefaultResourceLoader, SettingsManager } = await import("@earendil-works/pi-coding-agent");
  const settingsManager = SettingsManager.create(projectDir, agentDir, { projectTrusted: false });
  const loader = new DefaultResourceLoader({
    cwd: projectDir,
    agentDir,
    settingsManager,
    noContextFiles: true,
  });
  await loader.reload({ resolveProjectTrust: async () => false });

  const extensionResult = loader.getExtensions();
  assert(extensionResult.errors.length === 0,
    `Extension load errors:\n${extensionResult.errors.map((entry) => `${entry.path}: ${entry.error}`).join("\n")}`);
  const skillResult = loader.getSkills();
  const promptResult = loader.getPrompts();
  assert(skillResult.diagnostics.length === 0,
    `Skill diagnostics:\n${skillResult.diagnostics.map((entry) => JSON.stringify(entry)).join("\n")}`);
  assert(promptResult.diagnostics.length === 0,
    `Prompt diagnostics:\n${promptResult.diagnostics.map((entry) => JSON.stringify(entry)).join("\n")}`);

  const expectedRoots = new Set([
    repositoryRoot,
    ...catalogSources.map((source) => realpathSync(join(npmRoot, "node_modules", packageNameFromSource(source)))),
  ]);
  for (const entry of extensionResult.extensions) resourceBelongsToExactRoot(entry, entry.resolvedPath, expectedRoots);
  for (const entry of skillResult.skills) resourceBelongsToExactRoot(entry, entry.filePath, expectedRoots);
  for (const entry of promptResult.prompts) resourceBelongsToExactRoot(entry, entry.filePath, expectedRoots);

  assert(extensionResult.extensions.length === 11,
    `Expected exactly 11 extensions, found ${extensionResult.extensions.length}`);
  assert(skillResult.skills.length === 4, `Expected exactly 4 skills, found ${skillResult.skills.length}`);
  assert(promptResult.prompts.length === 9, `Expected exactly 9 prompts, found ${promptResult.prompts.length}`);

  const extensionsForSource = (source) => extensionResult.extensions.filter((entry) => entry.sourceInfo.source === source);
  const skillsForSource = (source) => skillResult.skills.filter((entry) => entry.sourceInfo.source === source);
  const promptsForSource = (source) => promptResult.prompts.filter((entry) => entry.sourceInfo.source === source);

  console.log("\nDiscovered extension sources:");
  for (const extension of extensionResult.extensions) {
    console.log(`  ${extension.sourceInfo.source}: ${extension.resolvedPath}`);
  }

  const belongsToArcwell = (entry) => entry.sourceInfo.baseDir && realpathSync(entry.sourceInfo.baseDir) === repositoryRoot;
  const arcwellExtensions = extensionResult.extensions.filter(belongsToArcwell);
  const arcwellSkills = skillResult.skills.filter(belongsToArcwell);
  const arcwellPrompts = promptResult.prompts.filter(belongsToArcwell);
  assert(arcwellExtensions.length === 1 && normalizeRelative(repositoryRoot, arcwellExtensions[0].resolvedPath) === "dist/extensions/arcwell-protections.js",
    "Arcwell extension was not discovered from the installed local package");
  assert(JSON.stringify(arcwellSkills.map((entry) => entry.name).sort()) === JSON.stringify(["code-review", "debug"]),
    "Arcwell skills were not discovered exactly");
  assert(JSON.stringify(arcwellPrompts.map((entry) => entry.name).sort()) === JSON.stringify(["implement", "implement-and-review", "scout-and-plan"]),
    "Arcwell prompts were not discovered exactly");

  for (const source of catalogSources) {
    const expectedPath = EXPECTED_EXTERNAL_EXTENSIONS.get(source);
    assert(expectedPath, `No expected external resource declaration for ${source}`);
    const extensions = extensionsForSource(source);
    assert(extensions.some((entry) => entry.sourceInfo.baseDir && normalizeRelative(entry.sourceInfo.baseDir, entry.resolvedPath) === expectedPath),
      `${source} extension ${expectedPath} was not discovered`);
  }
  const subagentsSource = "npm:pi-subagents@0.61.0";
  assert(skillsForSource(subagentsSource).length === 2,
    `Expected exactly 2 ${subagentsSource} skills, found ${skillsForSource(subagentsSource).length}`);
  assert(promptsForSource(subagentsSource).length === 6,
    `Expected exactly 6 ${subagentsSource} prompts, found ${promptsForSource(subagentsSource).length}`);

  console.log(`\nDiscovered ${extensionResult.extensions.length} extensions, ${skillResult.skills.length} skills, and ${promptResult.prompts.length} prompts.`);
}

try {
  const piPackageJson = readJson(join(repositoryRoot, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"));
  assert(piPackageJson.version === PI_VERSION,
    `Expected repository-local Pi ${PI_VERSION}, found ${piPackageJson.version ?? "none"}`);
  const piCli = join(repositoryRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
  assert(existsSync(piCli), `Repository-local Pi CLI not found: ${piCli}`);

  const { PACKAGE_CATALOG, validateCatalog } = await import("../dist/src/setup/catalog.js");
  validateCatalog(PACKAGE_CATALOG);
  const catalogSources = PACKAGE_CATALOG.map((entry) => entry.source);
  assert(catalogSources.length === EXPECTED_EXTERNAL_EXTENSIONS.size,
    `Expected ${EXPECTED_EXTERNAL_EXTENSIONS.size} accepted packages, found ${catalogSources.length}`);
  assert(catalogSources.every((source) => EXPECTED_EXTERNAL_EXTENSIONS.has(source)),
    "Accepted package catalog and smoke expectations differ");

  run(process.execPath, [piCli, "install", repositoryRoot], { cwd: projectDir });
  for (const source of catalogSources) run(process.execPath, [piCli, "install", source], { cwd: projectDir });

  const npmRoot = join(agentDir, "npm");
  await verifyResources(catalogSources, npmRoot);

  const packages = reportPackageMetadata(npmRoot);
  const installedTopLevel = new Set(packages.map(({ manifest }) => `${manifest.name}@${manifest.version}`));
  for (const source of catalogSources) {
    const spec = source.slice("npm:".length);
    assert(installedTopLevel.has(spec), `Exact accepted package was not installed: ${spec}`);
  }

  for (const [auditRoot, label] of [[repositoryRoot, "repository"], [npmRoot, "isolated Pi npm root"]]) {
    const auditOutput = run(npm.command, [...npm.args, "audit", "--omit=dev", "--audit-level=low", "--json"], {
      cwd: auditRoot,
      capture: true,
    });
    const audit = JSON.parse(auditOutput);
    assert(audit.metadata?.vulnerabilities?.total === 0,
      `${label} npm audit reported ${audit.metadata?.vulnerabilities?.total ?? "unknown"} vulnerabilities`);
    console.log(`\n${label} npm audit --omit=dev: 0 vulnerabilities`);
  }
  console.log(`Pi package smoke passed with repository-local Pi ${PI_VERSION}.`);
} finally {
  try {
    cleanupScratch();
  } finally {
    restoreProcessEnvironment();
  }
}
