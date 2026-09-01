import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import test from "node:test";

import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });

const belongsToPackage = (path: string): boolean => {
  const candidate = relative(process.cwd(), path);
  return candidate === "" || (!candidate.startsWith("..") && !isAbsolute(candidate));
};

test("package manifest declares the exact native Pi resource set", () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    private?: boolean;
    license?: string;
    files?: string[];
    keywords?: string[];
    engines?: { node?: string };
    scripts?: { prepack?: string; "test:packages"?: string };
    pi?: { extensions?: string[]; skills?: string[]; prompts?: string[] };
  };
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.license, "MIT");
  assert.deepEqual(pkg.files, [
    "dist/src/**/*.js",
    "dist/extensions/*.js",
    "extensions/upstream/**/*.ts",
    "content/AGENTS.md",
    "content/presets.json",
    "skills/*/SKILL.md",
    "skills/*/*.sh",
    "agents/*.md",
    "prompts/*.md",
    "docs/*.md",
    "README.md",
    "LICENSE",
    "NOTICE",
  ]);
  assert.deepEqual(pkg.keywords, ["pi-package"]);
  assert.equal(pkg.engines?.node, ">=24.15.0");
  assert.equal(pkg.scripts?.prepack, "npm --silent run build");
  assert.equal(pkg.scripts?.["test:packages"], "npm run build && node scripts/pi-package-smoke.mjs");
  assert.deepEqual(pkg.pi, {
    extensions: [
      "./dist/extensions/arcwell-protections.js",
      "./extensions/upstream/subagent/index.ts",
      "./extensions/upstream/plan-mode/index.ts",
      "./extensions/upstream/preset.ts",
      "./extensions/upstream/questionnaire.ts",
      "./extensions/upstream/todo.ts",
      "./extensions/upstream/tools.ts",
    ],
    skills: [
      "./skills/code-review/SKILL.md",
      "./skills/debug/SKILL.md",
      "./skills/delegating/SKILL.md",
      "./skills/domain-modeling/SKILL.md",
      "./skills/grilling/SKILL.md",
      "./skills/handoff/SKILL.md",
      "./skills/implementing/SKILL.md",
      "./skills/planning/SKILL.md",
      "./skills/research/SKILL.md",
      "./skills/scope-check/SKILL.md",
      "./skills/tdd/SKILL.md",
      "./skills/verification/SKILL.md",
      "./skills/web/SKILL.md",
    ],
    prompts: ["./prompts/implement.md", "./prompts/implement-and-review.md", "./prompts/scout-and-plan.md"],
  });
});

test("package filters can omit every Arcwell resource without touching Pi state", async () => {
  const root = mkdtempSync(join(temporaryRoot, "package-filter-"));
  try {
    const settingsManager = SettingsManager.inMemory(
      { packages: [{ source: process.cwd(), extensions: [], skills: [], prompts: [] }] },
      { projectTrusted: false },
    );
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir: join(root, "agent"),
      settingsManager,
      noContextFiles: true,
    });
    await loader.reload({ resolveProjectTrust: async () => false });

    assert.deepEqual(loader.getExtensions().extensions.filter((entry) => belongsToPackage(entry.resolvedPath)), []);
    assert.deepEqual(loader.getSkills().skills.filter((skill) => belongsToPackage(skill.filePath)), []);
    assert.deepEqual(loader.getPrompts().prompts.filter((prompt) => belongsToPackage(prompt.filePath)), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DefaultResourceLoader discovers only package resources without project leakage", async () => {
  const root = mkdtempSync(join(temporaryRoot, "package-resources-"));
  try {
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    mkdirSync(join(cwd, ".pi", "skills", "leak"), { recursive: true });
    mkdirSync(join(cwd, ".pi", "prompts"), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(cwd, ".pi", "skills", "leak", "SKILL.md"), "---\nname: leak\ndescription: must not load\n---\n");
    writeFileSync(join(cwd, ".pi", "prompts", "leak.md"), "must not load\n");

    const settingsManager = SettingsManager.inMemory(
      { packages: [process.cwd()] },
      { projectTrusted: false },
    );
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noContextFiles: true,
    });
    await loader.reload({ resolveProjectTrust: async () => false });

    const extensions = loader.getExtensions();
    assert.deepEqual(extensions.errors, []);
    assert.deepEqual(
      extensions.extensions
        .filter((entry) => belongsToPackage(entry.resolvedPath))
        .map((entry) => relative(process.cwd(), entry.resolvedPath).replaceAll("\\", "/"))
        .sort(),
      [
        "dist/extensions/arcwell-protections.js",
        "extensions/upstream/plan-mode/index.ts",
        "extensions/upstream/preset.ts",
        "extensions/upstream/questionnaire.ts",
        "extensions/upstream/subagent/index.ts",
        "extensions/upstream/todo.ts",
        "extensions/upstream/tools.ts",
      ],
    );
    // A colon-space inside an unquoted description parses as a nested YAML mapping and the
    // skill is dropped silently. Assert the diagnostics so the cause is named, not inferred
    // from a missing entry in the list below.
    assert.deepEqual(
      loader.getSkills().diagnostics.filter((entry) => entry.path !== undefined && belongsToPackage(entry.path)),
      [],
    );
    const skills = loader.getSkills().skills;
    assert.deepEqual(
      skills.filter((skill) => belongsToPackage(skill.filePath)).map((skill) => skill.name).sort(),
      [
        "code-review", "debug", "delegating", "domain-modeling", "grilling", "handoff",
        "implementing", "planning", "research", "scope-check", "tdd", "verification", "web",
      ],
    );
    // Subagent definitions are not package resources: Pi's manifest carries no `agents` key,
    // and the subagent extension reads them from <agentDir>/agents. Setup installs them there,
    // so their coverage lives with the install path rather than here.
    const prompts = loader.getPrompts().prompts;
    assert.deepEqual(
      prompts.filter((prompt) => belongsToPackage(prompt.filePath)).map((prompt) => prompt.name).sort(),
      ["implement", "implement-and-review", "scout-and-plan"],
    );
    assert.equal(skills.some((skill) => skill.name === "leak"), false);
    assert.equal(prompts.some((prompt) => prompt.name === "leak"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
