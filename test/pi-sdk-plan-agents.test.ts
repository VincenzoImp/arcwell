import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  createBoundedPlanAgents,
  type AgentSessionRequest,
  type AgentSessionFactory,
} from "../src/backends/pi-sdk-plan-agents.js";
import {
  assessReadOnlyToolCall,
  createIsolatedResources,
  stableProjectRead,
} from "../src/backends/pi-sdk-session-factory.js";

const scout = { summary: "repo", files: [{ path: "src/cli.ts", relevance: "entry" }], risks: [] };
const plan = {
  goal: "plan",
  steps: [{ id: "step", needs: [], description: "step", files: ["src/cli.ts"], verification: "npm test" }],
  risks: [],
};

test("Pi SDK boundary creates isolated read-only sessions and disposes them", async () => {
  const requests: AgentSessionRequest[] = [];
  let disposed = 0;
  const factory: AgentSessionFactory = async (request) => {
    requests.push(request);
    return {
      async prompt() { return request.role === "scout" ? scout : plan; },
      dispose() { disposed += 1; },
    };
  };
  const agents = createBoundedPlanAgents(factory);
  const report = await agents.scout({ goal: "plan", cwd: "/project" });
  await agents.planner({ goal: "plan", cwd: "/project", scout: report });

  assert.deepEqual(requests.map((request) => request.role), ["scout", "planner"]);
  assert.equal(requests.every((request) => request.resourcePolicy === "arcwell-only"), true);
  assert.equal(requests.every((request) => request.tools.join(",") === "read,ls"), true);
  assert.equal(requests.every((request) => !request.systemPrompt.includes("/project")), true);
  assert.equal(disposed, 2);
});

test("Pi SDK tool policy blocks paths outside the project and likely secrets", () => {
  const root = process.cwd();
  assert.equal(assessReadOnlyToolCall(root, "read", { path: "src/cli.ts" }).block, false);
  assert.match(assessReadOnlyToolCall(root, "read", { path: "/etc/passwd" }).reason ?? "", /project/);
  assert.match(assessReadOnlyToolCall(root, "read", { path: ".env.production" }).reason ?? "", /sensitive/);
  assert.match(assessReadOnlyToolCall(root, "read", { path: ".envrc" }).reason ?? "", /sensitive/);
  assert.match(assessReadOnlyToolCall(root, "read", { path: ".npmrc" }).reason ?? "", /sensitive/);
  assert.match(assessReadOnlyToolCall(root, "read", { path: ".git-credentials" }).reason ?? "", /sensitive/);
  assert.match(assessReadOnlyToolCall(root, "read", { path: ".pgpass" }).reason ?? "", /sensitive/);
  assert.match(assessReadOnlyToolCall(root, "read", { path: ".htpasswd" }).reason ?? "", /sensitive/);
  assert.match(assessReadOnlyToolCall(root, "read", { path: ".vault-token" }).reason ?? "", /sensitive/);
  assert.match(assessReadOnlyToolCall(root, "read", { path: ".docker/config.json" }).reason ?? "", /sensitive/);
  assert.match(assessReadOnlyToolCall(root, "read", { path: ".git/config" }).reason ?? "", /sensitive/);
  assert.match(assessReadOnlyToolCall(root, "read", { path: "terraform.tfstate" }).reason ?? "", /sensitive/);
  assert.match(assessReadOnlyToolCall(root, "read", { path: ".aws/credentials" }).reason ?? "", /sensitive/);
  assert.match(assessReadOnlyToolCall(root, "read", { path: "config/secrets.json" }).reason ?? "", /sensitive/);
  assert.match(assessReadOnlyToolCall(root, "read", { path: "config/auth.json" }).reason ?? "", /sensitive/);
});

test("stable project reads reject symlinks that escape the selected root", async () => {
  const parent = mkdtempSync(join(process.cwd(), ".tmp-tests", "read-boundary-"));
  const root = join(parent, "project");
  try {
    mkdirSync(root);
    const outside = join(parent, "outside.txt");
    writeFileSync(outside, "not readable from project");
    symlinkSync(outside, join(root, "link.txt"));
    await assert.rejects(() => stableProjectRead(root, join(root, "link.txt")), /outside the selected project/);
    writeFileSync(join(root, "safe.ts"), "export const answer = 42;\n");
    assert.match((await stableProjectRead(root, join(root, "safe.ts"))).toString("utf8"), /answer/);
    writeFileSync(join(root, "leak.ts"), "export const password = \"fake-credential-value\";\n");
    await assert.rejects(() => stableProjectRead(root, join(root, "leak.ts")), /appears to contain credentials/);
    writeFileSync(join(root, "prefixed-leak.ts"), "export const STRIPE_SECRET_KEY = \"rk_live_0123456789abcdef\";\n");
    await assert.rejects(() => stableProjectRead(root, join(root, "prefixed-leak.ts")), /appears to contain credentials/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("resource isolation ignores project package settings", async () => {
  const root = mkdtempSync(join(process.cwd(), ".tmp-tests", "resources-"));
  try {
    mkdirSync(join(root, ".pi"));
    writeFileSync(join(root, ".pi", "settings.json"), JSON.stringify({ packages: ["must-not-resolve.invalid@1.0.0"] }));
    const loader = await createIsolatedResources({
      role: "scout",
      cwd: root,
      tools: ["read", "ls"],
      resourcePolicy: "arcwell-only",
      systemPrompt: "isolated",
      submitTool: "submit_scout_report",
    });
    assert.equal(loader.getSkills().skills.length, 0);
    assert.equal(loader.getAgentsFiles().agentsFiles.length, 0);
    assert.equal(loader.getExtensions().extensions.every((entry) => entry.path.startsWith("<inline:")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("abort signal reaches session creation", async () => {
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  const factory: AgentSessionFactory = async (request) => {
    received = request.signal;
    controller.abort();
    throw new Error("aborted");
  };
  const agents = createBoundedPlanAgents(factory);
  await assert.rejects(() => agents.scout({ goal: "plan", cwd: process.cwd(), signal: controller.signal }), /scout session failed/);
  assert.equal(received, controller.signal);
  assert.equal(received?.aborted, true);
});

test("Pi SDK boundary disposes failed sessions without exposing raw errors", async () => {
  let disposed = false;
  const factory: AgentSessionFactory = async () => ({
    async prompt() { throw new Error("token=super-secret /Users/example"); },
    dispose() { disposed = true; },
  });
  const agents = createBoundedPlanAgents(factory);
  await assert.rejects(() => agents.scout({ goal: "plan", cwd: "/project" }), /scout session failed/);
  await assert.rejects(() => agents.scout({ goal: "plan", cwd: "/project" }), (error: unknown) => {
    assert.equal(String(error).includes("super-secret"), false);
    assert.equal(String(error).includes("/Users/example"), false);
    return true;
  });
  assert.equal(disposed, true);

  const badCleanup: AgentSessionFactory = async () => ({
    async prompt() { return scout; },
    dispose() { throw new Error("token=cleanup-secret /Users/example"); },
  });
  await assert.rejects(() => createBoundedPlanAgents(badCleanup).scout({ goal: "plan", cwd: "/project" }), (error: unknown) => {
    assert.match(String(error), /scout session cleanup failed/);
    assert.equal(String(error).includes("cleanup-secret"), false);
    return true;
  });
});
