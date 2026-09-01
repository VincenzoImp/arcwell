/**
 * One key in Pi's settings, so the working agreement reaches the agents Arcwell dispatches.
 *
 * Arcwell merges the agreement into `<agentDir>/AGENTS.md`, which pi-subagents calls *global*
 * context — and `inheritGlobalContext` defaults to false for every builtin. Verified on a real
 * machine: `scout` asked for a token that exists only in that file answered NONE, while
 * `planner`, which sets the flag in its own frontmatter, answered with the token. Without this,
 * every delegated turn runs with none of the standing preferences the environment exists to
 * carry.
 *
 * Only `inheritGlobalContext`, and only for the agents Arcwell's own prompts dispatch. Anything
 * else about those agents stays theirs.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { assertNoDuplicateJsonProperties } from "./manifest.js";
import { writeFileAtomic } from "./atomic-file.js";

/** The agents `/autonomous`, `/implement-and-review` and `/scout-and-plan` name. */
export const INHERITING_AGENTS = ["planner", "reviewer", "scout", "worker"] as const;

/** Settings past this size are not something to rewrite from here. */
export const MAX_SETTINGS_BYTES = 1024 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const settingsPath = (agentDir: string): string => join(agentDir, "settings.json");

/** What Arcwell sets, and the exact shape uninstall looks for before removing it. */
export function inheritGlobalContextOverrides(): Record<string, { inheritGlobalContext: boolean }> {
  return Object.fromEntries(INHERITING_AGENTS.map((name) => [name, { inheritGlobalContext: true }]));
}

function readSettings(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  if (Buffer.byteLength(text) > MAX_SETTINGS_BYTES) return undefined;
  assertNoDuplicateJsonProperties(text);
  const parsed: unknown = JSON.parse(text);
  return isRecord(parsed) ? parsed : undefined;
}

/**
 * Merges the overrides into `subagents.agentOverrides`, leaving every other key untouched and
 * never replacing an entry a user already wrote for the same agent.
 *
 * Returns true when the file changed, false when it already said this or could not be read.
 */
export function applySubagentOverrides(agentDir: string): boolean {
  const path = settingsPath(agentDir);
  const settings = readSettings(path);
  if (!settings) return false;

  const subagents = isRecord(settings.subagents) ? { ...settings.subagents } : {};
  const existing = isRecord(subagents.agentOverrides) ? subagents.agentOverrides : {};
  const merged: Record<string, unknown> = { ...existing };
  let changed = false;
  for (const [name, override] of Object.entries(inheritGlobalContextOverrides())) {
    const current = isRecord(merged[name]) ? merged[name] : undefined;
    if (current?.inheritGlobalContext !== undefined) continue;
    merged[name] = { ...current, ...override };
    changed = true;
  }
  if (!changed) return false;

  subagents.agentOverrides = merged;
  writeFileAtomic(path, `${JSON.stringify({ ...settings, subagents }, null, 2)}\n`, {
    targetDescription: "Pi settings",
    defaultMode: 0o600,
  });
  return true;
}

/**
 * Removes only entries that still say exactly what Arcwell wrote, and prunes the containers it
 * created. An agent a user has since given other fields keeps them, minus our flag.
 */
export function removeSubagentOverrides(agentDir: string): boolean {
  const path = settingsPath(agentDir);
  const settings = readSettings(path);
  if (!settings || !isRecord(settings.subagents)) return false;

  const subagents = { ...settings.subagents };
  if (!isRecord(subagents.agentOverrides)) return false;
  const overrides: Record<string, unknown> = { ...subagents.agentOverrides };
  let changed = false;
  for (const name of INHERITING_AGENTS) {
    const current = overrides[name];
    if (!isRecord(current) || current.inheritGlobalContext !== true) continue;
    const { inheritGlobalContext: _removed, ...rest } = current;
    if (Object.keys(rest).length > 0) overrides[name] = rest;
    else delete overrides[name];
    changed = true;
  }
  if (!changed) return false;

  if (Object.keys(overrides).length > 0) subagents.agentOverrides = overrides;
  else delete subagents.agentOverrides;
  const next: Record<string, unknown> = { ...settings };
  if (Object.keys(subagents).length > 0) next.subagents = subagents;
  else delete next.subagents;
  writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`, {
    targetDescription: "Pi settings",
    defaultMode: 0o600,
  });
  return true;
}
