import { createHash } from "node:crypto";
import { existsSync, realpathSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import {
  parseResumableFeatureCheckpoint,
  parseStoredFeatureCheckpoint,
  storedFeatureCheckpointDigest,
  type StoredFeatureCheckpoint,
} from "./feature-checkpoint.js";
import type { FeaturePreparationResult } from "./feature-preparation.js";
import type {
  FeatureCheckpointReference,
  FeatureLedger,
  FeatureWorkerRecord,
  LoadedFeatureCheckpoint,
} from "./feature-ledger-types.js";
import {
  assertApprovalAppendBudget,
  assertSessionAppendBudget,
  loadValidatedSessionFile,
  safeSessionDirectory,
  validateSessionDirectoryForWrite,
} from "./pi-session-files.js";
import { createProjectSnapshot } from "./project-snapshot.js";

export type {
  FeatureCheckpointReference,
  FeatureLedger,
  FeatureWorkerRecord,
  LoadedFeatureCheckpoint,
} from "./feature-ledger-types.js";

const CHECKPOINT_TYPE = "arcwell.feature.checkpoint.v1";
const APPROVAL_TYPE = "arcwell.feature.approval.v1";
const WORKER_RESULT_TYPE = "arcwell.feature.worker-result.v1";

interface ApprovalData {
  approvalId: string;
  checkpointEntryId: string;
  checkpointDigest: string;
  gate: "approve-plan";
  approved: true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function customData(entry: Record<string, unknown>, customType: string): unknown | undefined {
  return entry.type === "custom" && entry.customType === customType ? entry.data : undefined;
}

function approvalData(value: unknown): value is ApprovalData {
  return isRecord(value) && Object.keys(value).length === 5
    && typeof value.approvalId === "string" && typeof value.checkpointEntryId === "string"
    && typeof value.checkpointDigest === "string" && value.gate === "approve-plan" && value.approved === true;
}

function assertReference(reference: FeatureCheckpointReference): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(reference.sessionId)
    || !/^[0-9a-f]{8}$/.test(reference.entryId) || !/^[0-9a-f]{64}$/.test(reference.digest)) {
    throw new Error("feature checkpoint reference must use exact lowercase identifiers");
  }
}

function approvalId(reference: FeatureCheckpointReference): string {
  return createHash("sha256")
    .update(`arcwell.feature.approval.v1\0${reference.sessionId}\0${reference.entryId}\0${reference.digest}`)
    .digest("hex");
}

async function flushNewCustomSession(manager: SessionManager, signal?: AbortSignal): Promise<void> {
  const target = manager.getSessionFile();
  if (!target) throw new Error("Pi did not allocate a persistent session file");
  if (existsSync(target)) throw new Error("Pi session target already exists");
  const packageEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  const moduleUrl = pathToFileURL(join(dirname(packageEntry), "core", "session-export.js")).href;
  const { exportSessionToJsonl } = await import(moduleUrl) as {
    exportSessionToJsonl(session: SessionManager, outputPath: string): string;
  };
  signal?.throwIfAborted();
  const staging = `${target}.arcwell-${process.pid}.tmp`;
  if (existsSync(staging)) throw new Error("Pi session staging path already exists");
  try {
    exportSessionToJsonl(manager, staging);
    renameSync(staging, target);
  } finally {
    rmSync(staging, { force: true });
  }
}

export class PiFeatureLedger implements FeatureLedger {
  constructor(private readonly sessionDir?: string) {}

  async saveCheckpoint(cwd: string, value: FeaturePreparationResult, signal?: AbortSignal): Promise<FeatureCheckpointReference> {
    signal?.throwIfAborted();
    const canonicalCwd = realpathSync.native(cwd);
    const checkpoint = parseResumableFeatureCheckpoint(value, canonicalCwd);
    const stored: StoredFeatureCheckpoint = {
      schemaVersion: 1,
      checkpoint,
      projectSnapshot: await createProjectSnapshot(canonicalCwd, checkpoint, signal),
    };
    const digest = storedFeatureCheckpointDigest(stored);
    const directory = safeSessionDirectory(canonicalCwd, this.sessionDir, true);
    await validateSessionDirectoryForWrite(directory, signal);
    const manager = SessionManager.create(canonicalCwd, directory);
    manager.appendSessionInfo("Arcwell feature workflow");
    const entryId = manager.appendCustomEntry(CHECKPOINT_TYPE, stored);
    await flushNewCustomSession(manager, signal);
    return { sessionId: manager.getSessionId(), entryId, digest };
  }

  async loadCheckpoint(
    cwd: string,
    reference: FeatureCheckpointReference,
    signal?: AbortSignal,
  ): Promise<LoadedFeatureCheckpoint> {
    assertReference(reference);
    return { ...reference, stored: await this.readCheckpoint(cwd, reference, signal) };
  }

  async approvePlan(
    cwd: string,
    reference: FeatureCheckpointReference,
    signal?: AbortSignal,
  ): Promise<{ id: string }> {
    assertReference(reference);
    signal?.throwIfAborted();
    const session = await loadValidatedSessionFile(cwd, reference.sessionId, this.sessionDir, signal);
    this.validCheckpointEntry(session.entries, reference, session.canonicalCwd);
    const id = approvalId(reference);
    const matchesApproval = (data: unknown): data is ApprovalData => approvalData(data)
      && data.approvalId === id && data.checkpointEntryId === reference.entryId
      && data.checkpointDigest === reference.digest;
    const existing = session.entries.some((entry) => matchesApproval(customData(entry, APPROVAL_TYPE)));
    signal?.throwIfAborted();
    if (!existing) {
      assertApprovalAppendBudget(session.byteSize);
      const manager = SessionManager.open(session.path, this.sessionDir);
      if (manager.getSessionId() !== reference.sessionId) throw new Error("Pi session identity changed before approval");
      manager.appendCustomEntry(APPROVAL_TYPE, {
        approvalId: id,
        checkpointEntryId: reference.entryId,
        checkpointDigest: reference.digest,
        gate: "approve-plan",
        approved: true,
      } satisfies ApprovalData);
    } else {
      signal?.throwIfAborted();
    }
    const confirmed = await loadValidatedSessionFile(
      cwd,
      reference.sessionId,
      this.sessionDir,
      existing ? signal : undefined,
    );
    const recorded = confirmed.entries.some((entry) => matchesApproval(customData(entry, APPROVAL_TYPE)));
    if (!recorded) throw new Error("feature approval was not durably recorded in the selected Pi session");
    return { id };
  }

  async requireApproval(
    cwd: string,
    reference: FeatureCheckpointReference,
    expectedApprovalId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    assertReference(reference);
    if (!/^[0-9a-f]{64}$/.test(expectedApprovalId) || approvalId(reference) !== expectedApprovalId) {
      throw new Error("feature approval identity is invalid");
    }
    const session = await loadValidatedSessionFile(cwd, reference.sessionId, this.sessionDir, signal);
    this.validCheckpointEntry(session.entries, reference, session.canonicalCwd);
    const found = session.entries.some((entry) => {
      const data = customData(entry, APPROVAL_TYPE);
      return approvalData(data) && data.approvalId === expectedApprovalId
        && data.checkpointEntryId === reference.entryId && data.checkpointDigest === reference.digest;
    });
    if (!found) throw new Error("approved feature gate was not found in the Pi session");
  }

  async recordWorkerResult(
    cwd: string,
    reference: FeatureCheckpointReference,
    record: FeatureWorkerRecord,
    signal?: AbortSignal,
  ): Promise<{ entryId: string }> {
    await this.requireApproval(cwd, reference, record.approvalId, signal);
    signal?.throwIfAborted();
    const session = await loadValidatedSessionFile(cwd, reference.sessionId, this.sessionDir, signal);
    const stored = this.validCheckpointEntry(session.entries, reference, session.canonicalCwd);
    this.validateWorkerRecord(record, reference, stored);
    const payloadBytes = Buffer.byteLength(JSON.stringify(record));
    assertSessionAppendBudget(session.byteSize, payloadBytes);
    const manager = SessionManager.open(session.path, this.sessionDir);
    const entryId = manager.appendCustomEntry(WORKER_RESULT_TYPE, record);
    const confirmed = await loadValidatedSessionFile(cwd, reference.sessionId, this.sessionDir);
    const persisted = confirmed.entries.some((entry) => entry.id === entryId && customData(entry, WORKER_RESULT_TYPE) !== undefined);
    if (!persisted) throw new Error("worker result was not durably recorded in the selected Pi session");
    return { entryId };
  }

  private validateWorkerRecord(
    record: FeatureWorkerRecord,
    reference: FeatureCheckpointReference,
    stored: StoredFeatureCheckpoint,
  ): void {
    const task = stored.checkpoint.artifacts["task-partitions"].find((candidate) => candidate.id === record.taskId);
    const allowed = new Set(task?.files ?? []);
    const expectedWorkspaceId = `${reference.sessionId}-${record.taskId}-${record.approvalId.slice(0, 12)}`;
    if (!task || record.schemaVersion !== 1 || record.workflow !== "feature" || record.node !== "implement"
      || record.workspaceId !== expectedWorkspaceId || record.changes.length === 0
      || !record.changes.every((change) => allowed.has(change.path)
        && ["added", "modified"].includes(change.status)
        && /^[0-9a-f]{64}$/.test(change.afterDigest)
        && (change.beforeDigest === undefined || /^[0-9a-f]{64}$/.test(change.beforeDigest))
        && Number.isInteger(change.bytes) && change.bytes >= 0)) {
      throw new Error("worker result does not match the approved task contract");
    }
  }

  private async readCheckpoint(
    cwd: string,
    reference: FeatureCheckpointReference,
    signal?: AbortSignal,
  ): Promise<StoredFeatureCheckpoint> {
    const session = await loadValidatedSessionFile(cwd, reference.sessionId, this.sessionDir, signal);
    return this.validCheckpointEntry(session.entries, reference, session.canonicalCwd);
  }

  private validCheckpointEntry(
    entries: Array<Record<string, unknown>>,
    reference: FeatureCheckpointReference,
    canonicalCwd: string,
  ): StoredFeatureCheckpoint {
    const entry = entries.find((candidate) => candidate.id === reference.entryId);
    const data = entry ? customData(entry, CHECKPOINT_TYPE) : undefined;
    if (data === undefined) throw new Error("feature checkpoint entry was not found in the Pi session");
    if (storedFeatureCheckpointDigest(data) !== reference.digest) {
      throw new Error("feature checkpoint contents changed after it was emitted");
    }
    return parseStoredFeatureCheckpoint(data, canonicalCwd);
  }
}
