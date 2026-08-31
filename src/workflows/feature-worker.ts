import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { chmod, lstat, readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { containsLikelySecret, sensitiveName, stableProjectRead } from "../backends/project-read-boundary.js";
import type {
  FeatureCheckpointReference,
  FeatureLedger,
  FeatureWorkerRecord,
} from "./feature-ledger.js";
import { featureGraphDigest } from "./feature-preparation.js";
import { createProjectSnapshot, relevantProjectPaths } from "./project-snapshot.js";
import { textIsPortable } from "./plan.js";

const MAX_WORKSPACE_FILES = 512;
const MAX_CHANGED_FILE_BYTES = 512 * 1024;
const MAX_CHANGESET_BYTES = 2 * 1024 * 1024;
const MAX_CHANGESET_FILES = 32;
const MAX_WORKER_RECORD_BYTES = 60 * 1024;

export function defaultFeatureWorkspaceRoot(): string {
  return join(getAgentDir(), "arcwell", "workspaces");
}

/** Trusted execution adapter. Production uses the Pi SDK adapter with only Arcwell tools. */
export interface FeatureWorkerAgent {
  execute(input: {
    cwd: string;
    task: { id: string; description: string; files: string[]; verification: string };
    projectSummary: string;
    signal?: AbortSignal;
  }): Promise<{ summary: string; verificationNotes: string[] }>;
}

export interface FeatureWorkerResult extends FeatureWorkerRecord {
  status: "succeeded";
  workersStarted: 1;
  ledgerEntryId: string;
}

function ensureDirectory(path: string): string {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const segment of relative(root, absolute).split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error("workspace path must not contain symbolic links");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      break;
    }
  }
  mkdirSync(absolute, { recursive: true });
  if (lstatSync(absolute).isSymbolicLink() || !lstatSync(absolute).isDirectory()) {
    throw new Error("workspace root must be a regular directory");
  }
  return realpathSync.native(absolute);
}

function workspacePath(root: string, portablePath: string): string {
  const path = resolve(root, portablePath);
  const fromRoot = relative(root, path);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("worker path escapes the isolated workspace");
  }
  return path;
}

async function materializeWorkspace(
  sourceRoot: string,
  workspace: string,
  paths: string[],
  signal?: AbortSignal,
): Promise<Map<string, string | undefined>> {
  const baseline = new Map<string, string | undefined>();
  for (const path of paths) {
    signal?.throwIfAborted();
    const source = resolve(sourceRoot, path);
    const target = workspacePath(workspace, path);
    mkdirSync(dirname(target), { recursive: true });
    try {
      const metadata = await lstat(source);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("worker source paths must be regular files");
      const content = await stableProjectRead(sourceRoot, source);
      const mode = metadata.mode & 0o777;
      writeFileSync(target, content, { mode, flag: "wx" });
      await chmod(target, mode);
      baseline.set(path, createHash("sha256").update(content).digest("hex"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      baseline.set(path, undefined);
    }
  }
  return baseline;
}

async function listWorkspaceFiles(root: string, signal?: AbortSignal): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      signal?.throwIfAborted();
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("worker created a symbolic link");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
      else throw new Error("worker created an unsupported filesystem entry");
      if (files.length > MAX_WORKSPACE_FILES) throw new Error("worker workspace exceeds the file budget");
    }
  };
  await visit(root);
  return files.sort();
}

async function collectChanges(
  workspace: string,
  baseline: Map<string, string | undefined>,
  allowed: Set<string>,
  signal?: AbortSignal,
): Promise<FeatureWorkerRecord["changes"]> {
  const files = await listWorkspaceFiles(workspace, signal);
  const allPaths = new Set([...baseline.keys(), ...files]);
  const changes: FeatureWorkerRecord["changes"] = [];
  let totalBytes = 0;
  for (const path of [...allPaths].sort()) {
    signal?.throwIfAborted();
    const absolute = workspacePath(workspace, path);
    let content: Buffer | undefined;
    try { content = await readFile(absolute); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const beforeDigest = baseline.get(path);
    const afterDigest = content ? createHash("sha256").update(content).digest("hex") : undefined;
    if (beforeDigest === afterDigest) continue;
    if (!allowed.has(path)) throw new Error("worker changed files outside the approved task files");
    if (!content) throw new Error("file deletion is not supported by the first worker vertical");
    if (content.length > MAX_CHANGED_FILE_BYTES || content.includes(0) || containsLikelySecret(content)) {
      throw new Error("worker changeset contains an unsafe or oversized file");
    }
    totalBytes += content.length;
    if (totalBytes > MAX_CHANGESET_BYTES) throw new Error("worker changeset exceeds the byte budget");
    if (changes.length >= MAX_CHANGESET_FILES) throw new Error("worker changeset exceeds the file budget");
    changes.push({
      path,
      status: beforeDigest ? "modified" : "added",
      ...(beforeDigest ? { beforeDigest } : {}),
      afterDigest: afterDigest!,
      bytes: content.length,
    });
  }
  if (changes.length === 0) throw new Error("worker produced no approved file changes");
  return changes;
}

export async function runFeatureWorker(
  input: FeatureCheckpointReference & {
    cwd: string;
    workspaceRoot: string;
    approvalId: string;
    taskId: string;
    signal?: AbortSignal;
  },
  ledger: FeatureLedger,
  agent: FeatureWorkerAgent,
): Promise<FeatureWorkerResult> {
  input.signal?.throwIfAborted();
  const reference = { sessionId: input.sessionId, entryId: input.entryId, digest: input.digest };
  const loaded = await ledger.loadCheckpoint(input.cwd, reference, input.signal);
  if (loaded.stored.checkpoint.graphDigest !== featureGraphDigest()) {
    throw new Error("workflow graph has changed since approval");
  }
  await ledger.requireApproval(input.cwd, reference, input.approvalId, input.signal);
  const currentSnapshot = await createProjectSnapshot(input.cwd, loaded.stored.checkpoint, input.signal);
  if (currentSnapshot.digest !== loaded.stored.projectSnapshot.digest
    || currentSnapshot.fileCount !== loaded.stored.projectSnapshot.fileCount) {
    throw new Error("project snapshot has changed since approval");
  }
  const task = loaded.stored.checkpoint.artifacts["task-partitions"].find((candidate) => candidate.id === input.taskId);
  if (!task) throw new Error("approved worker task was not found");
  if (task.needs.length > 0) throw new Error("the first worker vertical only executes root tasks");
  if (task.files.some(sensitiveName)) throw new Error("approved task includes a likely sensitive file");
  const canonicalProject = realpathSync.native(input.cwd);
  const requestedWorkspaceRoot = resolve(input.workspaceRoot);
  const projectToWorkspace = relative(canonicalProject, requestedWorkspaceRoot);
  const workspaceToProject = relative(requestedWorkspaceRoot, canonicalProject);
  const overlaps = (path: string) => path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
  if (overlaps(projectToWorkspace) || overlaps(workspaceToProject)) {
    throw new Error("workspace root must be disjoint from the selected project");
  }
  const rootExisted = existsSync(requestedWorkspaceRoot);
  const workspaceRoot = ensureDirectory(requestedWorkspaceRoot);
  const workspaceId = `${input.sessionId}-${task.id}-${input.approvalId.slice(0, 12)}`;
  const workspace = join(workspaceRoot, workspaceId);
  if (lstatSync(workspaceRoot).isSymbolicLink()) throw new Error("workspace root must not be a symbolic link");
  mkdirSync(workspace, { recursive: false });
  try {
    const paths = relevantProjectPaths(loaded.stored.checkpoint);
    const baseline = await materializeWorkspace(input.cwd, workspace, paths, input.signal);
    const copiedSnapshot = await createProjectSnapshot(workspace, loaded.stored.checkpoint, input.signal);
    if (copiedSnapshot.digest !== loaded.stored.projectSnapshot.digest
      || copiedSnapshot.fileCount !== loaded.stored.projectSnapshot.fileCount) {
      throw new Error("isolated workspace does not match the approved project snapshot");
    }
    const artifact = await agent.execute({
      cwd: workspace,
      task: { id: task.id, description: task.description, files: [...task.files], verification: task.verification },
      projectSummary: loaded.stored.checkpoint.artifacts["project-map"].summary,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    input.signal?.throwIfAborted();
    if (!textIsPortable(artifact.summary, workspace) || !artifact.verificationNotes.every((note) => textIsPortable(note, workspace))) {
      throw new Error("worker returned a non-portable artifact");
    }
    const changes = await collectChanges(workspace, baseline, new Set(task.files), input.signal);
    const record: FeatureWorkerRecord = {
      schemaVersion: 1,
      workflow: "feature",
      node: "implement",
      approvalId: input.approvalId,
      taskId: task.id,
      workspaceId,
      summary: artifact.summary,
      verificationNotes: [...artifact.verificationNotes],
      changes,
    };
    if (Buffer.byteLength(JSON.stringify(record)) > MAX_WORKER_RECORD_BYTES) {
      throw new Error("worker result exceeds the metadata budget");
    }
    const persisted = await ledger.recordWorkerResult(input.cwd, reference, record, input.signal);
    return { ...record, status: "succeeded", workersStarted: 1, ledgerEntryId: persisted.entryId };
  } catch (error) {
    rmSync(workspace, { recursive: true, force: true });
    if (!rootExisted) rmSync(workspaceRoot, { recursive: true, force: true });
    throw error;
  }
}
