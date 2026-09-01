import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import test from "node:test";

import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const helpersUrl = new URL("../../scripts/package-smoke-helpers.mjs", import.meta.url);
const { npmInvocation } = await import(helpersUrl.href) as {
  npmInvocation(): { command: string; args: string[] };
};

const repositoryRoot = process.cwd();
const temporaryRoot = join(repositoryRoot, ".tmp-tests");
const npmCache = join(repositoryRoot, ".npm-cache");
mkdirSync(temporaryRoot, { recursive: true });
mkdirSync(npmCache, { recursive: true });

interface PackFile {
  path: string;
  size: number;
  mode: number;
}

interface PackResult {
  filename: string;
  files: PackFile[];
}

function runPack(extraArguments: readonly string[]): PackResult {
  const npm = npmInvocation();
  const output = execFileSync(npm.command, [
    ...npm.args,
    "pack",
    "--json",
    "--ignore-scripts",
    "--cache",
    npmCache,
    ...extraArguments,
  ], { cwd: repositoryRoot, encoding: "utf8" });
  const parsed = JSON.parse(output) as PackResult[];
  assert.equal(parsed.length, 1);
  return parsed[0]!;
}

function allowedPayloadPath(path: string): boolean {
  return [
    /^README\.md$/,
    /^LICENSE$/,
    /^NOTICE$/,
    /^package\.json$/,
    /^content\/AGENTS\.md$/,
    /^docs\/[^/]+\.md$/,
    /^skills\/(?:code-review|debug)\/SKILL\.md$/,
    /^prompts\/(?:implement|implement-and-review|scout-and-plan)\.md$/,
    /^dist\/src\/.*\.js$/,
    /^dist\/extensions\/(?:arcwell-protections|effects)\.js$/,
  ].some((pattern) => pattern.test(path));
}

function belongsTo(root: string, path: string): boolean {
  const candidate = relative(root, path);
  return candidate === "" || (!candidate.startsWith("..") && !isAbsolute(candidate));
}

test("npm pack dry-run contains only the explicit publish payload", () => {
  const result = runPack(["--dry-run"]);
  const paths = result.files.map((file) => file.path);

  assert.ok(paths.includes("dist/src/cli.js"), "compiled CLI must be packed");
  assert.ok(paths.includes("dist/extensions/arcwell-protections.js"), "compiled Pi extension must be packed");
  assert.ok(paths.includes("content/AGENTS.md"));
  assert.ok(paths.includes("skills/code-review/SKILL.md"));
  assert.ok(paths.includes("prompts/implement.md"));
  assert.ok(paths.includes("README.md"));
  assert.ok(paths.includes("docs/specification.md"));
  assert.ok(paths.includes("LICENSE"));
  assert.ok(paths.includes("NOTICE"));
  assert.ok(paths.every(allowedPayloadPath), `unexpected payload paths: ${paths.filter((path) => !allowedPayloadPath(path)).join(", ")}`);
  assert.equal(paths.some((path) => /(?:^|\/)(?:test|tmp|\.tmp-tests|node_modules)(?:\/|$)/.test(path)), false);
  assert.equal(paths.some((path) => /(?:^|\/)(?:Users|home)(?:\/|$)/.test(path)), false);
});

test("DefaultResourceLoader discovers exact resources from a packed and stably extracted directory", async () => {
  const root = mkdtempSync(join(temporaryRoot, "packed-resources-"));
  try {
    const packDirectory = join(root, "pack");
    const extractionDirectory = join(root, "extracted");
    mkdirSync(packDirectory);
    mkdirSync(extractionDirectory);
    const result = runPack(["--pack-destination", packDirectory]);
    const tarball = join(packDirectory, result.filename);
    execFileSync("tar", ["-xzf", tarball, "-C", extractionDirectory]);
    const packageRoot = join(extractionDirectory, "package");
    const project = join(root, "project");
    const agentDir = join(root, "agent");
    mkdirSync(project);

    const settingsManager = SettingsManager.inMemory(
      { packages: [packageRoot] },
      { projectTrusted: false },
    );
    const loader = new DefaultResourceLoader({
      cwd: project,
      agentDir,
      settingsManager,
      noContextFiles: true,
    });
    await loader.reload({ resolveProjectTrust: async () => false });

    const extensions = loader.getExtensions();
    assert.deepEqual(extensions.errors, []);
    assert.deepEqual(
      extensions.extensions
        .filter((entry) => belongsTo(packageRoot, entry.resolvedPath))
        .map((entry) => relative(packageRoot, entry.resolvedPath).replaceAll("\\", "/")),
      ["dist/extensions/arcwell-protections.js"],
    );
    assert.deepEqual(
      loader.getSkills().skills
        .filter((skill) => belongsTo(packageRoot, skill.filePath))
        .map((skill) => skill.name)
        .sort(),
      ["code-review", "debug"],
    );
    assert.deepEqual(
      loader.getPrompts().prompts
        .filter((prompt) => belongsTo(packageRoot, prompt.filePath))
        .map((prompt) => prompt.name)
        .sort(),
      ["implement", "implement-and-review", "scout-and-plan"],
    );
    assert.equal(existsSync(agentDir), false, "resource discovery must not create Pi state");

    const packedText = readdirSync(packageRoot, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
      .join("\n");
    assert.equal(packedText.includes(repositoryRoot), false);
    assert.equal(packedText.includes(homedir()), false);
    assert.doesNotMatch(packedText, /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/);
    assert.doesNotMatch(packedText, /AKIA[0-9A-Z]{16}/);
    assert.doesNotMatch(packedText, /gh[pousr]_[A-Za-z0-9]{20,}/);
    assert.doesNotMatch(packedText, /(?:sk-|npm_|xox[baprs]-)[A-Za-z0-9_-]{16,}/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
