import assert from "node:assert/strict";
import test from "node:test";

import { createProtectionHandlers, registerProtectionHandlers } from "../extensions/arcwell-protections.js";
import type { RuntimeConfig } from "../src/setup/types.js";

const guarded: RuntimeConfig = {
  schemaVersion: 1,
  posture: "guarded",
  protections: { effects: true, secrets: true, redaction: true },
};

const headless = {
  hasUI: false,
  ui: { select: async () => "Block", notify: () => undefined },
};

test("effects protection fails closed headlessly and can be disabled independently", async () => {
  const enabled = createProtectionHandlers(structuredClone(guarded));
  for (const command of [
    "git push origin main",
    "git -C workspace push origin main",
    "command git push origin main",
    "sh -c 'git push origin main'",
    "bash -lc 'docker push registry.example/app:latest'",
    "PowerShell -Command 'docker push registry.example/app:latest'",
    "powershell.exe -Command 'docker push registry.example/app:latest'",
    "pwsh.exe -Command 'terraform apply'",
    "docker image push registry.example/app:latest",
    "terraform apply -auto-approve",
    "npm publish",
    "yarn npm publish",
    "gh --repo owner/project pr merge 42",
    "gh release create v1",
    "kubectl --context production apply -f app.yml",
  ]) {
    const result = await enabled.toolCall({ toolName: "bash", input: { command } }, headless);
    assert.equal(result?.block, true, command);
  }

  const previousBypass = process.env.PI_ALLOW_REMOTE_EFFECTS;
  process.env.PI_ALLOW_REMOTE_EFFECTS = "1";
  try {
    assert.equal(
      (await enabled.toolCall({ toolName: "bash", input: { command: "git push origin main" } }, headless))?.block,
      true,
    );
  } finally {
    if (previousBypass === undefined) delete process.env.PI_ALLOW_REMOTE_EFFECTS;
    else process.env.PI_ALLOW_REMOTE_EFFECTS = previousBypass;
  }

  const config = structuredClone(guarded);
  config.protections.effects = false;
  const disabled = createProtectionHandlers(config);
  assert.equal(await disabled.toolCall({ toolName: "bash", input: { command: "git push origin main" } }, headless), undefined);
  assert.equal((await disabled.toolCall({ toolName: "read", input: { path: ".env" } }, headless))?.block, true);
});

test("recognized effects require explicit interactive approval", async () => {
  const handlers = createProtectionHandlers(structuredClone(guarded));
  const allowed = await handlers.toolCall(
    { toolName: "bash", input: { command: "npm publish" } },
    { hasUI: true, ui: { select: async () => "Allow once", notify: () => undefined } } as never,
  );
  assert.equal(allowed, undefined);
  const denied = await handlers.toolCall(
    { toolName: "bash", input: { command: "npm publish" } },
    { hasUI: true, ui: { select: async () => "Block", notify: () => undefined } } as never,
  );
  assert.equal(denied?.block, true);
});

test("secrets protection blocks protected names referenced through shell and PowerShell wrappers", async () => {
  const handlers = createProtectionHandlers(structuredClone(guarded));
  for (const command of [
    "cat .env",
    "cat .env; printf safe",
    "bash -lc 'cat ~/.ssh/id_ed25519'",
    "command sh -c 'head -1 auth.json'",
    "pwsh -Command 'Get-Content $HOME\\.npmrc'",
    "powershell -Command \"Get-Content prod.tfvars\"",
    "cat .e'n'v",
    "PowerShell -Command \"Get-Content ('.e' + 'nv')\"",
  ]) {
    const result = await handlers.toolCall({ toolName: "bash", input: { command } }, headless);
    assert.equal(result?.block, true, command);
  }
  for (const command of [
    "printf '%s' environment",
    "cat .e'$SECRET_SUFFIX'",
    "PowerShell -Command \"Get-Content ('.e' + $secretSuffix)\"",
  ]) {
    assert.equal(await handlers.toolCall({ toolName: "bash", input: { command } }, headless), undefined, command);
  }
});

test("user_bash uses the same effects and secrets decisions as bash tool calls", async () => {
  const handlers = createProtectionHandlers(structuredClone(guarded));
  assert.equal((await handlers.userBash({ command: "sh -c 'terraform apply'" }, headless))?.result.exitCode, 130);
  assert.equal((await handlers.userBash({ command: "Get-Content .env" }, headless))?.result.exitCode, 130);
  assert.equal(await handlers.userBash({ command: "printf safe" }, headless), undefined);
});

test("user_bash reuses one decision for repeated delivery of the same event", async () => {
  const handlers = createProtectionHandlers(structuredClone(guarded));
  const event = { command: "npm publish" };
  let selections = 0;
  const interactive = {
    hasUI: true,
    ui: {
      select: async () => { selections += 1; return "Allow once"; },
      notify: () => undefined,
    },
  };
  assert.equal(await handlers.userBash(event, interactive), undefined);
  assert.equal(await handlers.userBash(event, interactive), undefined);
  assert.equal(selections, 1);
});

test("extension registration intercepts both tool_call and user_bash", async () => {
  const hooks = new Map<string, (event: never, ctx: never) => unknown>();
  registerProtectionHandlers({
    on(name: string, handler: (event: never, ctx: never) => unknown) { hooks.set(name, handler); },
  } as never, structuredClone(guarded));

  assert.deepEqual([...hooks.keys()], ["tool_call", "tool_result", "user_bash"]);
  const toolResult = await hooks.get("tool_call")?.(
    { toolName: "bash", input: { command: "docker push example/app" } } as never,
    headless as never,
  ) as { block?: boolean } | undefined;
  assert.equal(toolResult?.block, true);
  const userResult = await hooks.get("user_bash")?.(
    { command: "terraform apply" } as never,
    headless as never,
  ) as { result?: { exitCode?: number } } | undefined;
  assert.equal(userResult?.result?.exitCode, 130);
});

test("secrets protection blocks protected reads and private-key material without owning redaction", async () => {
  const handlers = createProtectionHandlers(structuredClone(guarded));
  for (const path of [".env", ".env.production", ".ssh/id_ed25519", "auth.json", ".npmrc", "prod.tfvars"]) {
    const result = await handlers.toolCall({ toolName: "read", input: { path } }, headless);
    assert.equal(result?.block, true, path);
  }
  const privateKeyOutput = [{ type: "text", text: "-----BEGIN PRIVATE KEY-----\nmaterial" }] as const;
  const keyResult = handlers.toolResult({
    toolName: "custom",
    content: privateKeyOutput,
  });
  assert.equal(keyResult?.isError, true);
  assert.doesNotMatch(JSON.stringify(keyResult), /BEGIN PRIVATE KEY/);

  const ordinaryCredentialLikeOutput = [{ type: "text", text: "token sk-example" }] as const;
  assert.equal(handlers.toolResult({ toolName: "custom", content: ordinaryCredentialLikeOutput }), undefined);

  const config = structuredClone(guarded);
  config.protections.secrets = false;
  const disabled = createProtectionHandlers(config);
  assert.equal(await disabled.toolCall({ toolName: "read", input: { path: ".env" } }, headless), undefined);
  assert.equal(disabled.toolResult({ toolName: "custom", content: privateKeyOutput }), undefined);
});
