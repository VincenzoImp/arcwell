import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  applySubagentOverrides,
  INHERITING_AGENTS,
  removeSubagentOverrides,
  settingsPath,
} from "../src/setup/subagent-overrides.js";

const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });

const scratch = (settings: unknown): string => {
  const root = mkdtempSync(join(temporaryRoot, "subagent-overrides-"));
  if (settings !== undefined) writeFileSync(settingsPath(root), `${JSON.stringify(settings, null, 2)}\n`);
  return root;
};
const read = (root: string): Record<string, any> => JSON.parse(readFileSync(settingsPath(root), "utf8"));

test("every dispatched agent gains global context, and nothing else in settings moves", () => {
  const root = scratch({ theme: "tokyo-night", packages: ["npm:pi-subagents@0.62.0"], subagents: { maxDepth: 3 } });
  try {
    assert.equal(applySubagentOverrides(root), true);
    const settings = read(root);
    for (const name of INHERITING_AGENTS) {
      assert.deepEqual(settings.subagents.agentOverrides[name], { inheritGlobalContext: true });
    }
    assert.equal(settings.theme, "tokyo-night");
    assert.deepEqual(settings.packages, ["npm:pi-subagents@0.62.0"]);
    assert.equal(settings.subagents.maxDepth, 3);

    // Idempotent: a second setup finds it already said and rewrites nothing.
    assert.equal(applySubagentOverrides(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a value the user already chose is never overwritten, and never removed", () => {
  const root = scratch({
    subagents: { agentOverrides: { reviewer: { inheritGlobalContext: false, thinking: "max" } } },
  });
  try {
    assert.equal(applySubagentOverrides(root), true);
    const afterApply = read(root);
    assert.deepEqual(afterApply.subagents.agentOverrides.reviewer, { inheritGlobalContext: false, thinking: "max" });
    assert.deepEqual(afterApply.subagents.agentOverrides.scout, { inheritGlobalContext: true });

    removeSubagentOverrides(root);
    const afterRemove = read(root);
    assert.deepEqual(afterRemove.subagents.agentOverrides.reviewer, { inheritGlobalContext: false, thinking: "max" });
    assert.equal(afterRemove.subagents.agentOverrides.scout, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("removal restores the file to what it was, containers included", () => {
  const original = { theme: "tokyo-night" };
  const root = scratch(original);
  try {
    applySubagentOverrides(root);
    assert.equal(removeSubagentOverrides(root), true);
    assert.deepEqual(read(root), original);
    // `subagents` was ours to create, so it goes too rather than being left empty.
    assert.equal("subagents" in read(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unrelated fields on a touched agent survive removal", () => {
  const root = scratch({ subagents: { agentOverrides: { worker: { model: "qwen3-coder:30b" } }, maxDepth: 2 } });
  try {
    applySubagentOverrides(root);
    assert.deepEqual(read(root).subagents.agentOverrides.worker, { model: "qwen3-coder:30b", inheritGlobalContext: true });
    removeSubagentOverrides(root);
    const settings = read(root);
    assert.deepEqual(settings.subagents.agentOverrides.worker, { model: "qwen3-coder:30b" });
    assert.equal(settings.subagents.maxDepth, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("absent, oversized, and duplicated settings are left alone rather than guessed at", () => {
  const missing = mkdtempSync(join(temporaryRoot, "subagent-overrides-missing-"));
  try {
    assert.equal(applySubagentOverrides(missing), false);
    assert.equal(removeSubagentOverrides(missing), false);

    const duplicated = scratch(undefined);
    writeFileSync(settingsPath(duplicated), '{"theme":"a","theme":"b"}');
    assert.throws(() => applySubagentOverrides(duplicated), /duplicate property.*theme/);
    rmSync(duplicated, { recursive: true, force: true });
  } finally {
    rmSync(missing, { recursive: true, force: true });
  }
});
