import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import arcwellProtections, { registerProtectionHandlers } from "../extensions/arcwell-protections.js";
import { writeRuntimeConfigAtomic } from "../src/setup/config.js";
import type { RuntimeConfig } from "../src/setup/types.js";

const headless = {
  hasUI: false,
  ui: { select: async () => undefined, notify: () => undefined },
};

function loadedToolCall(config: RuntimeConfig): (event: unknown, context: unknown) => unknown {
  const hooks = new Map<string, (event: never, context: never) => unknown>();
  registerProtectionHandlers({
    on(name: string, handler: (event: never, context: never) => unknown) { hooks.set(name, handler); },
  } as never, config);
  return hooks.get("tool_call") as (event: unknown, context: unknown) => unknown;
}

test("loaded effects hook follows guarded, disabled, host, and headless behavior", async () => {
  const guarded: RuntimeConfig = {
    schemaVersion: 1,
    posture: "guarded",
    protections: { effects: true, secrets: false, redaction: false },
  };
  const guardedHook = loadedToolCall(guarded);
  assert.equal((await guardedHook({ toolName: "bash", input: { command: "git push origin main" } }, headless) as { block?: boolean }).block, true);

  const disabledHook = loadedToolCall({
    ...guarded,
    protections: { ...guarded.protections, effects: false },
  });
  assert.equal(await disabledHook({ toolName: "bash", input: { command: "git push origin main" } }, headless), undefined);

  const hostHook = loadedToolCall({
    schemaVersion: 1,
    posture: "host",
    protections: { effects: false, secrets: false, redaction: false },
  });
  assert.equal(await hostHook({ toolName: "bash", input: { command: "npm publish" } }, headless), undefined);
});

test("project config cannot weaken the global protection selection", async () => {
  const root = mkdtempSync(join(process.cwd(), ".tmp-tests", "global-protection-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    const globalAgentDir = join(root, "global-agent");
    const projectAgentDir = join(root, "project", ".pi", "agent");
    mkdirSync(globalAgentDir, { recursive: true });
    writeRuntimeConfigAtomic(join(globalAgentDir, "arcwell", "config.json"), {
      schemaVersion: 1,
      posture: "guarded",
      protections: { effects: true, secrets: true, redaction: true },
    });
    writeRuntimeConfigAtomic(join(projectAgentDir, "arcwell", "config.json"), {
      schemaVersion: 1,
      posture: "host",
      protections: { effects: false, secrets: false, redaction: false },
    });
    process.env.PI_CODING_AGENT_DIR = globalAgentDir;
    const hooks = new Map<string, (event: never, context: never) => unknown>();
    arcwellProtections({
      on(name: string, handler: (event: never, context: never) => unknown) { hooks.set(name, handler); },
    } as never);

    const result = await hooks.get("tool_call")?.(
      { toolName: "bash", input: { command: "git push origin main" } } as never,
      headless as never,
    ) as { block?: boolean } | undefined;
    assert.equal(result?.block, true);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("effects hook leaves documented static false-positive boundaries alone", async () => {
  const hook = loadedToolCall({
    schemaVersion: 1,
    posture: "guarded",
    protections: { effects: true, secrets: false, redaction: false },
  });
  for (const command of ["git status", "printf 'git push'", "git pushy", "npm view publish"]) {
    assert.equal(await hook({ toolName: "bash", input: { command } }, headless), undefined, command);
  }
});
