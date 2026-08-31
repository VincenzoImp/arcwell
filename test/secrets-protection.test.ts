import assert from "node:assert/strict";
import test from "node:test";

import { registerProtectionHandlers } from "../extensions/arcwell-protections.js";
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

test("loaded secrets hook follows guarded, disabled, host, and headless behavior", async () => {
  const guarded: RuntimeConfig = {
    schemaVersion: 1,
    posture: "guarded",
    protections: { effects: false, secrets: true, redaction: false },
  };
  const guardedHook = loadedToolCall(guarded);
  assert.equal((await guardedHook({ toolName: "read", input: { path: ".env" } }, headless) as { block?: boolean }).block, true);
  assert.equal((await guardedHook({ toolName: "bash", input: { command: "Get-Content auth.json" } }, headless) as { block?: boolean }).block, true);

  const disabledHook = loadedToolCall({
    ...guarded,
    protections: { ...guarded.protections, secrets: false },
  });
  assert.equal(await disabledHook({ toolName: "read", input: { path: ".env" } }, headless), undefined);

  const hostHook = loadedToolCall({
    schemaVersion: 1,
    posture: "host",
    protections: { effects: false, secrets: false, redaction: false },
  });
  assert.equal(await hostHook({ toolName: "read", input: { path: ".ssh/id_ed25519" } }, headless), undefined);
});

test("secrets hook documents static matching boundaries without claiming sandbox enforcement", async () => {
  const hook = loadedToolCall({
    schemaVersion: 1,
    posture: "guarded",
    protections: { effects: false, secrets: true, redaction: false },
  });
  for (const safe of ["environment.md", "credential-helper.ts", "printf public-key", "cat .e$SUFFIX"]) {
    assert.equal(await hook({ toolName: "bash", input: { command: safe } }, headless), undefined, safe);
  }
});
