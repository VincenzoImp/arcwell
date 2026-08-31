import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { assertNoSymbolicLinkComponents } from "./config.js";

export const ARCWELL_AGREEMENT_START = "<!-- arcwell:start -->";
export const ARCWELL_AGREEMENT_END = "<!-- arcwell:end -->";

function markerCount(text: string, marker: string): number {
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(marker, offset)) >= 0) {
    count += 1;
    offset += marker.length;
  }
  return count;
}

function normalizedManagedBlock(block: string): string {
  const start = block.indexOf(ARCWELL_AGREEMENT_START);
  const end = block.indexOf(ARCWELL_AGREEMENT_END);
  if (
    markerCount(block, ARCWELL_AGREEMENT_START) !== 1
    || markerCount(block, ARCWELL_AGREEMENT_END) !== 1
    || start !== 0
    || end <= start
    || block.slice(end + ARCWELL_AGREEMENT_END.length).trim() !== ""
  ) {
    throw new Error("working agreement source has malformed Arcwell markers");
  }
  return block.slice(0, end + ARCWELL_AGREEMENT_END.length);
}

export function workingAgreementDigest(block: string): string {
  return createHash("sha256").update(normalizedManagedBlock(block)).digest("hex");
}

interface ManagedBlockRange {
  start: number;
  end: number;
}

function managedBlockRange(existing: string): ManagedBlockRange | undefined {
  const startCount = markerCount(existing, ARCWELL_AGREEMENT_START);
  const endCount = markerCount(existing, ARCWELL_AGREEMENT_END);
  if (startCount === 0 && endCount === 0) return undefined;
  const start = existing.indexOf(ARCWELL_AGREEMENT_START);
  const endMarker = existing.indexOf(ARCWELL_AGREEMENT_END);
  if (startCount !== 1 || endCount !== 1 || endMarker <= start) {
    throw new Error("working agreement has malformed Arcwell markers");
  }
  return { start, end: endMarker + ARCWELL_AGREEMENT_END.length };
}

export function managedWorkingAgreementDigest(existing: string): string | undefined {
  const range = managedBlockRange(existing);
  if (!range) return undefined;
  return workingAgreementDigest(existing.slice(range.start, range.end));
}

export interface WorkingAgreementOriginalState {
  existed: boolean;
  endedWithNewline: boolean;
}

export function removeWorkingAgreementText(
  existing: string,
  originalState?: WorkingAgreementOriginalState,
): string {
  const range = managedBlockRange(existing);
  if (!range) return existing;
  let start = range.start;
  let end = range.end;
  if (existing.startsWith("\r\n", end)) end += 2;
  else if (existing.startsWith("\n", end)) end += 1;
  if (originalState?.existed && !originalState.endedWithNewline && start > 0 && existing[start - 1] === "\n") {
    start -= 1;
  }
  return `${existing.slice(0, start)}${existing.slice(end)}`;
}

export function mergeWorkingAgreementText(existing: string, block: string): string {
  const managed = normalizedManagedBlock(block);
  const startCount = markerCount(existing, ARCWELL_AGREEMENT_START);
  const endCount = markerCount(existing, ARCWELL_AGREEMENT_END);
  if (startCount === 0 && endCount === 0) {
    if (!existing) return `${managed}\n`;
    return `${existing}${existing.endsWith("\n") ? "" : "\n"}${managed}\n`;
  }
  const start = existing.indexOf(ARCWELL_AGREEMENT_START);
  const end = existing.indexOf(ARCWELL_AGREEMENT_END);
  if (startCount !== 1 || endCount !== 1 || end <= start) {
    throw new Error("working agreement has malformed Arcwell markers");
  }
  return `${existing.slice(0, start)}${managed}${existing.slice(end + ARCWELL_AGREEMENT_END.length)}`;
}

function writeAtomic(path: string, content: string, mode: number): void {
  const directory = dirname(path);
  assertNoSymbolicLinkComponents(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertNoSymbolicLinkComponents(directory);
  const temporary = join(directory, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", mode);
    writeFileSync(descriptor, content, "utf8");
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, mode);
    renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

function readWorkingAgreement(path: string): { content: string; mode: number } | undefined {
  assertNoSymbolicLinkComponents(path);
  if (!existsSync(path)) return undefined;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`working agreement target is a symbolic link: ${path}`);
  if (!stat.isFile()) throw new Error(`working agreement target is not a regular file: ${path}`);
  return { content: readFileSync(path, "utf8"), mode: stat.mode & 0o777 };
}

export function mergeWorkingAgreement(path: string, block: string): string {
  const current = readWorkingAgreement(path);
  const existing = current?.content ?? "";
  const merged = mergeWorkingAgreementText(existing, block);
  if (merged !== existing) writeAtomic(path, merged, current?.mode ?? 0o600);
  return workingAgreementDigest(block);
}

export function removeWorkingAgreement(
  path: string,
  originalState?: WorkingAgreementOriginalState,
): boolean {
  const current = readWorkingAgreement(path);
  if (!current) return false;
  const removed = removeWorkingAgreementText(current.content, originalState);
  if (removed === current.content) {
    if (removed === "" && originalState?.existed === false) {
      rmSync(path);
      return true;
    }
    return false;
  }
  if (removed === "" && originalState?.existed === false) rmSync(path);
  else writeAtomic(path, removed, current.mode);
  return true;
}
