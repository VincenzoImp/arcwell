import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

interface SmokeHelpers {
  createIsolatedEnvironment(source: NodeJS.ProcessEnv, isolated: {
    home: string;
    agentDir: string;
    npmCache: string;
    npmConfig: string;
  }): NodeJS.ProcessEnv;
  findInstallLifecycleScripts(packages: Array<{ manifest: Record<string, unknown> }>): string[];
  npmInvocation(options?: {
    environment?: NodeJS.ProcessEnv;
    execPath?: string;
    platform?: NodeJS.Platform;
    realpath?: (path: string) => string;
  }): { command: string; args: string[] };
  replaceProcessEnvironment(environment: NodeJS.ProcessEnv): () => void;
}

const helpersUrl = new URL("../../scripts/package-smoke-helpers.mjs", import.meta.url);
const helpers = await import(helpersUrl.href) as SmokeHelpers;

const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });

test("npmInvocation runs npm's CLI through Node when npm_execpath is available", () => {
  assert.deepEqual(helpers.npmInvocation({
    environment: { npm_execpath: "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" },
    execPath: "C:\\Program Files\\nodejs\\node.exe",
    platform: "win32",
  }), {
    command: "C:\\Program Files\\nodejs\\node.exe",
    args: ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js"],
  });
});

test("npmInvocation resolves a colocated Unix npm launcher to its CLI", () => {
  let resolvedPath = "";
  assert.deepEqual(helpers.npmInvocation({
    environment: {},
    execPath: "/opt/homebrew/Cellar/node/26.4.0/bin/node",
    platform: "darwin",
    realpath(path) {
      resolvedPath = path;
      return "/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js";
    },
  }), {
    command: "/opt/homebrew/Cellar/node/26.4.0/bin/node",
    args: ["/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js"],
  });
  assert.equal(resolvedPath, "/opt/homebrew/Cellar/node/26.4.0/bin/npm");
});

test("npmInvocation has deterministic CLI fallbacks without command shims", () => {
  assert.deepEqual(helpers.npmInvocation({
    environment: {},
    execPath: "C:\\Program Files\\nodejs\\node.exe",
    platform: "win32",
  }), {
    command: "C:\\Program Files\\nodejs\\node.exe",
    args: ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js"],
  });
  assert.deepEqual(helpers.npmInvocation({
    environment: {},
    execPath: "/opt/node/bin/node",
    platform: "linux",
    realpath() {
      throw new Error("npm launcher is absent");
    },
  }), {
    command: "/opt/node/bin/node",
    args: ["/opt/node/lib/node_modules/npm/bin/npm-cli.js"],
  });
});

test("isolated package-smoke environment is allowlist-only", () => {
  const environment = helpers.createIsolatedEnvironment({
    PATH: "/bin",
    SystemRoot: "C:\\Windows",
    LANG: "en_US.UTF-8",
    CI: "true",
    GITHUB_RUN_ID: "123",
    GITHUB_TOKEN: "secret",
    GH_TOKEN: "secret",
    GIT_ASKPASS: "/credential-helper",
    SSH_AUTH_SOCK: "/credential-agent",
    NPM_TOKEN: "secret",
    AWS_SECRET_ACCESS_KEY: "secret",
    npm_config_userconfig: "/private/npmrc",
    HTTPS_PROXY: "http://credential@example.test",
    CUSTOM_VALUE: "must-not-pass",
  }, {
    home: "/isolated/home",
    agentDir: "/isolated/agent",
    npmCache: "/isolated/cache",
    npmConfig: "/isolated/config/npmrc",
  });

  assert.equal(environment.PATH, "/bin");
  assert.equal(environment.SystemRoot, "C:\\Windows");
  assert.equal(environment.LANG, "en_US.UTF-8");
  assert.equal(environment.CI, "true");
  assert.equal(environment.GITHUB_RUN_ID, "123");
  assert.equal(environment.HOME, "/isolated/home");
  assert.equal(environment.USERPROFILE, "/isolated/home");
  assert.equal(environment.PI_CODING_AGENT_DIR, "/isolated/agent");
  assert.equal(environment.NPM_CONFIG_CACHE, "/isolated/cache");
  assert.equal(environment.NPM_CONFIG_GLOBALCONFIG, "/isolated/config/npmrc");
  assert.equal(environment.GITHUB_TOKEN, undefined);
  assert.equal(environment.GH_TOKEN, undefined);
  assert.equal(environment.GIT_ASKPASS, undefined);
  assert.equal(environment.SSH_AUTH_SOCK, undefined);
  assert.equal(environment.NPM_TOKEN, undefined);
  assert.equal(environment.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(environment.npm_config_userconfig, undefined);
  assert.equal(environment.HTTPS_PROXY, undefined);
  assert.equal(environment.CUSTOM_VALUE, undefined);
});

test("third-party extension child processes cannot inherit excluded credentials or npm config", async () => {
  const root = mkdtempSync(join(temporaryRoot, "package-smoke-env-"));
  const fixtureRoot = join(process.cwd(), "test", "fixtures", "pi-packages", "child-env");
  const originalValues = {
    NPM_TOKEN: process.env.NPM_TOKEN,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    npm_config_userconfig: process.env.npm_config_userconfig,
  };
  process.env.NPM_TOKEN = "npm-secret";
  process.env.AWS_SECRET_ACCESS_KEY = "aws-secret";
  process.env.npm_config_userconfig = join(root, "credentialed-npmrc");

  const environment = helpers.createIsolatedEnvironment(process.env, {
    home: join(root, "home"),
    agentDir: join(root, "agent"),
    npmCache: join(root, "cache"),
    npmConfig: join(root, "config", "npmrc"),
  });
  const restoreEnvironment = helpers.replaceProcessEnvironment(environment);
  try {
    const project = join(root, "project");
    mkdirSync(project, { recursive: true });
    const loader = new DefaultResourceLoader({
      cwd: project,
      agentDir: join(root, "agent"),
      settingsManager: SettingsManager.inMemory({ packages: [fixtureRoot] }, { projectTrusted: false }),
      noContextFiles: true,
    });
    await loader.reload({ resolveProjectTrust: async () => false });
    assert.deepEqual(loader.getExtensions().errors, []);
    assert.equal(loader.getExtensions().extensions.length, 1);
  } finally {
    restoreEnvironment();
    rmSync(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries(originalValues)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Arcwell declares separate prepare and explicit networked Git-source smokes", () => {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(manifest.scripts?.prepare, "npm run build");
  assert.equal(manifest.scripts?.["test:prepare"], "node scripts/prepare-smoke.mjs");
  assert.equal(manifest.scripts?.["test:git-source"], "node scripts/git-source-smoke.mjs");
  assert.equal(manifest.scripts?.["test:git-install"], undefined);
  assert.deepEqual({
    typescript: manifest.dependencies?.typescript,
    nodeTypes: manifest.dependencies?.["@types/node"],
    ajv: manifest.dependencies?.ajv,
  }, {
    typescript: "6.0.3",
    nodeTypes: "26.4.0",
    ajv: "8.20.0",
  });
  assert.equal(manifest.devDependencies?.typescript, undefined);
  assert.equal(manifest.devDependencies?.["@types/node"], undefined);
  assert.equal(manifest.devDependencies?.ajv, undefined);
  assert.equal(manifest.devDependencies?.["typescript-language-server"], "6.0.0");

  const prepareSmoke = readFileSync(join(process.cwd(), "scripts", "prepare-smoke.mjs"), "utf8");
  assert.match(prepareSmoke, /"install",\s*"--omit=dev"/);

  const gitSourceSmoke = readFileSync(join(process.cwd(), "scripts", "git-source-smoke.mjs"), "utf8");
  assert.match(gitSourceSmoke, /git:github\.com\/VincenzoImp\/arcwell@\$\{ref\}/);
  assert.match(gitSourceSmoke, /run\(process\.execPath, \[piCli, "install", source\]/);
  assert.match(gitSourceSmoke, /DefaultResourceLoader/);
});

test("install lifecycle declarations are returned as smoke failures", () => {
  const lifecycle = helpers.findInstallLifecycleScripts([
    { manifest: { name: "safe", version: "1.0.0" } },
    { manifest: { name: "unsafe", version: "2.0.0", scripts: { preinstall: "node pre.js", install: "node install.js", postinstall: "node post.js", test: "node test.js" } } },
  ]);
  assert.deepEqual(lifecycle, [
    "unsafe@2.0.0: preinstall=node pre.js",
    "unsafe@2.0.0: install=node install.js",
    "unsafe@2.0.0: postinstall=node post.js",
  ]);
});
