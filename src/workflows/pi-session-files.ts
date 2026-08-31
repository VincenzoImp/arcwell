import { constants, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { open, opendir } from "node:fs/promises";
import { join, parse, relative, resolve, sep } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

const MAX_SESSION_BYTES = 16 * 1024 * 1024;
const APPROVAL_APPEND_RESERVE = 4 * 1024;
const MAX_SESSION_FILES = 10_000;

export interface ValidatedSessionFile {
  path: string;
  canonicalCwd: string;
  entries: Array<Record<string, unknown>>;
  byteSize: number;
}

function inspectComponents(path: string, allowMissing: boolean): boolean {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const segments = relative(root, absolute).split(sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    let metadata;
    try {
      metadata = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && allowMissing) return false;
      throw error;
    }
    if (metadata.isSymbolicLink()) throw new Error("Pi session path must not contain symbolic links");
  }
  return true;
}

function defaultSessionDirectory(canonicalCwd: string): string {
  const safePath = `--${canonicalCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(getAgentDir(), "sessions", safePath);
}

export function safeSessionDirectory(cwd: string, configured: string | undefined, create: boolean): string {
  const canonicalCwd = realpathSync.native(cwd);
  const directory = resolve(configured ?? defaultSessionDirectory(canonicalCwd));
  let exists: boolean;
  try {
    exists = inspectComponents(directory, create);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !create) {
      throw new Error("feature session was not found for the selected project");
    }
    throw error;
  }
  if (!exists) {
    if (!create) throw new Error("feature session was not found for the selected project");
    mkdirSync(directory, { recursive: true });
    inspectComponents(directory, false);
  }
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory()) throw new Error("Pi session directory must be a regular directory");
  return directory;
}

export async function validateSessionDirectoryForWrite(directory: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const dir = await opendir(directory);
  try {
    let seen = 0;
    for await (const _entry of dir) {
      signal?.throwIfAborted();
      seen += 1;
      if (seen >= MAX_SESSION_FILES) throw new Error("Pi session directory exceeds the write budget");
    }
  } finally {
    await dir.close().catch(() => {});
  }
}

async function findSessionPath(directory: string, sessionId: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const suffix = `_${sessionId}.jsonl`;
  const matches: string[] = [];
  const dir = await opendir(directory);
  try {
    let seen = 0;
    for await (const entry of dir) {
      signal?.throwIfAborted();
      seen += 1;
      if (seen > MAX_SESSION_FILES) throw new Error("Pi session directory exceeds the discovery budget");
      if (entry.name.endsWith(suffix)) matches.push(entry.name);
    }
  } finally {
    await dir.close().catch(() => {});
  }
  if (matches.length !== 1) throw new Error("feature session was not found for the selected project");
  const path = join(directory, matches[0]!);
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) throw new Error("Pi session file must not be a symbolic link");
  if (!metadata.isFile()) throw new Error("Pi session path must name a regular file");
  return path;
}

async function readSessionEntries(
  path: string,
  canonicalCwd: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<Array<Record<string, unknown>>> {
  signal?.throwIfAborted();
  const expected = lstatSync(path, { bigint: true });
  if (expected.size > BigInt(MAX_SESSION_BYTES)) throw new Error("Pi session exceeds the read budget");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== expected.dev || opened.ino !== expected.ino || opened.size !== expected.size
      || opened.mtimeNs !== expected.mtimeNs || opened.ctimeNs !== expected.ctimeNs) {
      throw new Error("Pi session changed while it was opened");
    }
    const content = await handle.readFile({ encoding: "utf8" });
    signal?.throwIfAborted();
    const after = await handle.stat({ bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) {
      throw new Error("Pi session changed while it was read");
    }
    if (!content.endsWith("\n")) throw new Error("Pi session must end with a newline before approval append");
    const lines = content.trim().split("\n");
    if (lines.length < 2) throw new Error("Pi session does not contain an Arcwell checkpoint");
    let parsed: unknown[];
    try {
      parsed = lines.map((line) => JSON.parse(line) as unknown);
    } catch {
      throw new Error("Pi session contains invalid JSONL");
    }
    if (!parsed.every((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry))) {
      throw new Error("Pi session contains an invalid entry");
    }
    const entries = parsed as Array<Record<string, unknown>>;
    const header = entries[0]!;
    if (header.type !== "session" || header.version !== 3 || header.id !== sessionId || header.cwd !== canonicalCwd) {
      throw new Error("Pi session header does not match the requested Arcwell session");
    }
    const sessionEntries = entries.slice(1);
    const seenIds = new Set<string>();
    for (const entry of sessionEntries) {
      if (typeof entry.id !== "string" || !/^[0-9a-f]{8}$/.test(entry.id) || seenIds.has(entry.id)
        || (entry.parentId !== null && (typeof entry.parentId !== "string" || !seenIds.has(entry.parentId)))) {
        throw new Error("Pi session entry identifiers are invalid");
      }
      seenIds.add(entry.id);
    }
    return sessionEntries;
  } finally {
    await handle.close();
  }
}

export async function loadValidatedSessionFile(
  cwd: string,
  sessionId: string,
  configuredDirectory?: string,
  signal?: AbortSignal,
): Promise<ValidatedSessionFile> {
  const canonicalCwd = realpathSync.native(cwd);
  const directory = safeSessionDirectory(canonicalCwd, configuredDirectory, false);
  const path = await findSessionPath(directory, sessionId, signal);
  const entries = await readSessionEntries(path, canonicalCwd, sessionId, signal);
  return { path, canonicalCwd, entries, byteSize: Number(lstatSync(path, { bigint: true }).size) };
}

export function assertSessionAppendBudget(byteSize: number, payloadBytes: number): void {
  if (!Number.isInteger(payloadBytes) || payloadBytes < 0 || payloadBytes > 64 * 1024
    || byteSize > MAX_SESSION_BYTES - payloadBytes - APPROVAL_APPEND_RESERVE) {
    throw new Error("Pi session has insufficient space for a bounded Arcwell entry");
  }
}

export function assertApprovalAppendBudget(byteSize: number): void {
  assertSessionAppendBudget(byteSize, 0);
}
