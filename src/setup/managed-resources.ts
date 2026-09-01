/**
 * Files Arcwell installs whole into the agent directory, as opposed to the working agreement,
 * which is merged as a marked block into a file the user also owns.
 *
 * Two things need this. Pi's package manifest has no `agents` key, so subagent definitions
 * are only found at `<agentDir>/agents`; and preset.ts reads `<agentDir>/presets.json`. Both
 * are resources the package carries and setup must put on disk for them to exist at all.
 *
 * Each record keeps the digest of what Arcwell wrote and whether the path existed first, so
 * uninstall can restore exactly and doctor can tell a modified file from a missing one.
 */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { assertNoSymbolicLinkComponents, writeFileAtomic } from "./atomic-file.js";

export interface ManagedResource {
  /** Path relative to the agent directory, using forward slashes. */
  path: string;
  content: string;
}

export interface ManagedResourceRecord {
  path: string;
  digest: string;
  existedBefore: boolean;
}

/** Package-relative sources, paired with where each one lands under the agent directory. */
export const MANAGED_RESOURCE_SOURCES: ReadonlyArray<{ source: string; path: string }> = [
  { source: "agents/scout.md", path: "agents/scout.md" },
  { source: "agents/planner.md", path: "agents/planner.md" },
  { source: "agents/worker.md", path: "agents/worker.md" },
  { source: "agents/reviewer.md", path: "agents/reviewer.md" },
  { source: "content/presets.json", path: "presets.json" },
];

export function managedResourceDigest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function loadManagedResources(packageRoot: string): ManagedResource[] {
  return MANAGED_RESOURCE_SOURCES.map(({ source, path }) => ({
    path,
    content: readFileSync(join(packageRoot, source), "utf8"),
  }));
}

function resolveManaged(agentDir: string, path: string): string {
  if (path.startsWith("/") || path.includes("..")) throw new Error(`managed resource path is not relative: ${path}`);
  const resolved = join(agentDir, path);
  assertNoSymbolicLinkComponents(resolved);
  return resolved;
}

function currentDigest(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`managed resource target is a symbolic link: ${path}`);
  if (!stat.isFile()) throw new Error(`managed resource target is not a regular file: ${path}`);
  return managedResourceDigest(readFileSync(path, "utf8"));
}

export function installManagedResources(
  agentDir: string,
  resources: readonly ManagedResource[],
): ManagedResourceRecord[] {
  return resources.map((resource) => {
    const target = resolveManaged(agentDir, resource.path);
    const existedBefore = currentDigest(target) !== undefined;
    writeFileAtomic(target, resource.content, {
      targetDescription: `managed resource ${resource.path}`,
      defaultMode: 0o600,
    });
    return { path: resource.path, digest: managedResourceDigest(resource.content), existedBefore };
  });
}

/** Returns the paths whose content no longer matches what Arcwell installed. */
export function verifyManagedResources(
  agentDir: string,
  records: readonly ManagedResourceRecord[],
): string[] {
  return records
    .filter((record) => {
      try {
        return currentDigest(resolveManaged(agentDir, record.path)) !== record.digest;
      } catch {
        return true;
      }
    })
    .map((record) => record.path);
}

/**
 * Removes only what is byte-for-byte what Arcwell wrote, and only where nothing was there
 * before. A file the user has since edited is left alone and reported, because deleting it
 * would destroy work Arcwell does not own.
 */
export function removeManagedResources(
  agentDir: string,
  records: readonly ManagedResourceRecord[],
): { removed: string[]; kept: string[] } {
  const removed: string[] = [];
  const kept: string[] = [];
  for (const record of records) {
    const target = resolveManaged(agentDir, record.path);
    const digest = currentDigest(target);
    if (digest === undefined) continue;
    if (digest !== record.digest || record.existedBefore) {
      kept.push(record.path);
      continue;
    }
    rmSync(target);
    if (existsSync(target)) throw new Error(`managed resource remained after removal: ${record.path}`);
    removed.push(record.path);
  }
  return { removed, kept };
}
