/**
 * What is actually on disk, compared against what the catalog says was audited.
 *
 * A pinned version says which release was asked for. It does not say which bytes arrived: a
 * registry, a mirror or a compromised publish can serve something else under the same number.
 * npm writes the tarball's integrity hash for every installed package into
 * `<agentDir>/npm/node_modules/.package-lock.json`, so the comparison costs no network and no
 * re-download — it reads what the install already recorded.
 *
 * This is a detection, not a defence: it says the artifact is not the one that was reviewed. It
 * cannot say the reviewed one was safe.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { CatalogEntry } from "./catalog.js";

/** Past this the lock file is not something to parse from here. */
export const MAX_LOCK_BYTES = 8 * 1024 * 1024;

export interface IntegrityMismatch {
  source: string;
  expected: string;
  /** What npm recorded, or undefined when the package is absent from the lock file. */
  actual: string | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const lockPath = (agentDir: string): string =>
  join(agentDir, "npm", "node_modules", ".package-lock.json");

/** `npm:@scope/name@1.2.3` -> `@scope/name`. */
export function packageNameOf(source: string): string {
  const body = source.replace(/^npm:/, "");
  return body.slice(0, body.lastIndexOf("@"));
}

/**
 * Integrity per package name, as npm recorded it at install time.
 *
 * Returns undefined when the lock file is missing or unreadable, which is not the same as a
 * mismatch: callers report that as unverifiable rather than as tampering.
 */
export function installedIntegrity(agentDir: string): Map<string, string> | undefined {
  const path = lockPath(agentDir);
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    const text = readFileSync(path, "utf8");
    if (Buffer.byteLength(text) > MAX_LOCK_BYTES) return undefined;
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isRecord(parsed.packages)) return undefined;

  const byName = new Map<string, string>();
  for (const [key, value] of Object.entries(parsed.packages)) {
    // Keys are paths like `node_modules/@scope/name`; nested copies repeat the prefix and the
    // last segment pair is the package. Only top-level entries are ours to check.
    const name = key.replace(/^node_modules\//, "");
    if (!name || name.includes("node_modules/")) continue;
    if (isRecord(value) && typeof value.integrity === "string") byName.set(name, value.integrity);
  }
  return byName;
}

/**
 * Entries whose installed bytes are not the ones the catalog recorded.
 *
 * A package absent from the lock file is reported with `actual: undefined`. That is a real
 * finding: something the manifest selected is not accounted for by the install.
 */
export function integrityMismatches(
  agentDir: string,
  entries: readonly CatalogEntry[],
): IntegrityMismatch[] | undefined {
  const installed = installedIntegrity(agentDir);
  if (!installed) return undefined;
  return entries.flatMap((entry) => {
    const actual = installed.get(packageNameOf(entry.source));
    return actual === entry.integrity ? [] : [{ source: entry.source, expected: entry.integrity, actual }];
  });
}
