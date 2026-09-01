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
    /^CHANGELOG\.md$/,
    /^LICENSE$/,
    /^NOTICE$/,
    /^package\.json$/,
    /^content\/AGENTS\.md$/,
    /^content\/presets\.json$/,
    /^docs\/[^/]+\.md$/,
    /^skills\/[a-z-]+\/SKILL\.md$/,
    /^skills\/web\/(?:search|fetch)\.sh$/,
    /^agents\/(?:scout|planner|worker|reviewer)\.md$/,
    /^prompts\/[a-z-]+\.md$/,
    /^extensions\/upstream\/(?:[a-z-]+\/)?[a-z-]+\.ts$/,
    /^dist\/src\/.*\.js$/,
    /^dist\/extensions\/(?:arcwell-memory|arcwell-protections|effects)\.js$/,
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
  assert.ok(paths.includes("agents/reviewer.md"));
  assert.ok(paths.includes("prompts/implement.md"));

  // A skill script that arrives without its execute bit fails at the moment the agent
  // counts on it, and content-only comparison cannot see the difference.
  for (const script of result.files.filter((file) => file.path.endsWith(".sh"))) {
    assert.equal(script.mode & 0o111, 0o111, `${script.path} must stay executable in the payload`);
  }
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
        .map((entry) => relative(packageRoot, entry.resolvedPath).replaceAll("\\", "/"))
        .sort(),
      [
        "dist/extensions/arcwell-memory.js",
        "dist/extensions/arcwell-protections.js",
        "extensions/upstream/plan-mode/index.ts",
        "extensions/upstream/preset.ts",
        "extensions/upstream/questionnaire.ts",
        "extensions/upstream/subagent/index.ts",
        "extensions/upstream/todo.ts",
        "extensions/upstream/tools.ts",
      ],
    );
    assert.deepEqual(
      loader.getSkills().skills
        .filter((skill) => belongsTo(packageRoot, skill.filePath))
        .map((skill) => skill.name)
        .sort(),
      [
        "code-review", "debug", "delegating", "domain-modeling", "grilling", "handoff",
        "implementing", "planning", "research", "scope-check", "tdd", "verification", "web",
      ],
    );
    assert.deepEqual(
      loader.getPrompts().prompts
        .filter((prompt) => belongsTo(packageRoot, prompt.filePath))
        .map((prompt) => prompt.name)
        .sort(),
      ["autonomous", "implement", "implement-and-review", "quick", "scout-and-plan"],
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
