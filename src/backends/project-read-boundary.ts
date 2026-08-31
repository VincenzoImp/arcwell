import { randomUUID } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { access, chmod, lstat, open, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

import { createReadToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export interface ToolPolicyDecision {
  block: boolean;
  reason?: string;
}

export const sensitiveName = (path: string): boolean => {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const segments = normalized.split("/");
  const name = basename(normalized);
  return segments.some((segment) => [".git", ".aws", ".ssh", ".gnupg", ".azure", ".kube", ".docker", ".terraform"].includes(segment))
    || [".envrc", ".npmrc", ".netrc", ".pypirc", ".pgpass", ".my.cnf", ".git-credentials", ".dockerconfigjson", ".htpasswd", ".vault-token"].includes(name)
    || /^\.env(?:\.|$)/.test(name)
    || /\.(?:tfvars|tfvars\.json|tfstate|tfstate\.backup|pem|key|p12|pfx|sqlite|sqlite3|db)$/.test(name)
    || /^(?:auth|credentials?|secrets?|tokens?|trust)(?:\.|$)/.test(name)
    || /^service[-_.]?account.*\.json$/.test(name)
    || /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/.test(name);
};

export function assessReadOnlyToolCall(
  cwd: string,
  toolName: string,
  input: Record<string, unknown>,
): ToolPolicyDecision {
  if (toolName === "submit_scout_report" || toolName === "submit_project_plan") return { block: false };
  if (!(["read", "ls"] as const).includes(toolName as "read" | "ls")) {
    return { block: true, reason: "tool is outside Arcwell's read-only allowlist" };
  }
  const requested = typeof input.path === "string" ? input.path : ".";
  const root = realpathSync.native(cwd);
  const candidate = resolve(root, requested);
  let actual = candidate;
  try { actual = realpathSync.native(candidate); } catch { /* The tool reports missing paths. */ }
  const fromRoot = relative(root, actual);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    return { block: true, reason: "path is outside the selected project" };
  }
  if (toolName === "read" && sensitiveName(actual)) {
    return { block: true, reason: "reading likely sensitive files is not allowed" };
  }
  return { block: false };
}

function canonicalProjectPath(cwd: string, path: string, protectContent: boolean): string {
  const root = realpathSync.native(cwd);
  const actual = realpathSync.native(path);
  const fromRoot = relative(root, actual);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("path is outside the selected project");
  }
  if (protectContent && sensitiveName(actual)) throw new Error("reading likely sensitive files is not allowed");
  return actual;
}

interface FileSnapshot {
  dev: number | bigint;
  ino: number | bigint;
  size: number | bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}

const sameSnapshot = (left: FileSnapshot, right: FileSnapshot) => left.dev === right.dev
  && left.ino === right.ino && left.size === right.size
  && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;

export function containsLikelySecret(content: Buffer): boolean {
  if (content.includes(0)) return true;
  const text = content.toString("utf8");
  return /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(text)
    || /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i.test(text)
    || /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(text)
    || /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|[rs]k_live_[A-Za-z0-9_-]{12,})\b/.test(text)
    || /["']?(?:[A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?KEY|CLIENT[_-]?SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY|SECRET|TOKEN)[A-Z0-9_]*)["']?\s*[:=]\s*["'][^"'\s$]{8,}["']/i.test(text);
}

export async function stableProjectRead(cwd: string, path: string): Promise<Buffer> {
  const actual = canonicalProjectPath(cwd, path, true);
  const expected = await stat(actual, { bigint: true });
  const handle = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameSnapshot(expected, opened)) throw new Error("file changed during boundary validation");
    const content = await handle.readFile();
    const currentPath = canonicalProjectPath(cwd, actual, true);
    const current = await stat(currentPath, { bigint: true });
    if (currentPath !== actual || !sameSnapshot(opened, current)) throw new Error("file changed during read");
    if (containsLikelySecret(content)) throw new Error("file content appears to contain credentials");
    return content;
  } finally {
    await handle.close();
  }
}

export function createProjectWriteTool(cwd: string, allowedPaths: string[]) {
  const allowed = new Set(allowedPaths);
  return defineTool({
    name: "write_file",
    label: "Write approved workspace file",
    description: "Atomically create or replace one file declared by the approved task.",
    parameters: Type.Object({
      path: Type.String({ minLength: 1 }),
      content: Type.String({ maxLength: 512 * 1024 }),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, params) => {
      if (!allowed.has(params.path)) throw new Error("path is outside the approved task files");
      if (sensitiveName(params.path)) throw new Error("writing likely sensitive files is not allowed");
      const target = resolve(cwd, params.path);
      const parent = canonicalProjectPath(cwd, resolve(target, ".."), false);
      let mode = 0o644;
      try {
        const existing = await lstat(target);
        if (existing.isSymbolicLink()) throw new Error("approved file must not be a symbolic link");
        mode = existing.mode & 0o777;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const content = Buffer.from(params.content, "utf8");
      if (content.length > 512 * 1024 || containsLikelySecret(content)) {
        throw new Error("file content is unsafe or exceeds the worker budget");
      }
      const staging = resolve(parent, `.arcwell-${process.pid}-${randomUUID()}.tmp`);
      try {
        await writeFile(staging, content, { flag: "wx", mode });
        await chmod(staging, mode);
        await rename(staging, target);
      } finally {
        await rm(staging, { force: true });
      }
      return { content: [{ type: "text" as const, text: `Wrote ${params.path}` }], details: {} };
    },
  });
}

export function createProjectReadTools(cwd: string) {
  const safeRead = createReadToolDefinition(cwd, {
    operations: {
      access: async (path) => access(canonicalProjectPath(cwd, path, true)),
      readFile: async (path) => stableProjectRead(cwd, path),
    },
  });
  const safeLs = defineTool({
    name: "ls",
    label: "List project directory",
    description: "List one directory inside the selected project without reading file contents.",
    parameters: Type.Object({
      path: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, params) => {
      const actual = canonicalProjectPath(cwd, resolve(cwd, params.path ?? "."), false);
      const before = await stat(actual, { bigint: true });
      const entries = await readdir(actual, { withFileTypes: true });
      const currentPath = canonicalProjectPath(cwd, actual, false);
      const after = await stat(currentPath, { bigint: true });
      if (currentPath !== actual || !sameSnapshot(before, after)) throw new Error("directory changed during listing");
      const rendered = entries
        .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
        .sort()
        .slice(0, params.limit ?? 200);
      return { content: [{ type: "text" as const, text: rendered.join("\n") || "(empty directory)" }], details: {} };
    },
  });
  return [safeRead, safeLs];
}
