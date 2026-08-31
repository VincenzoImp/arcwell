import { constants, realpathSync } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";

import { compareText } from "../order.js";
import type { ProjectSnapshot, ResumableFeatureCheckpoint } from "./feature-checkpoint.js";

const MAX_SNAPSHOT_FILES = 256;
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

interface ComponentSnapshot {
  path: string;
  dev: bigint;
  ino: bigint;
  mode: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}

export function relevantProjectPaths(checkpoint: ResumableFeatureCheckpoint): string[] {
  return [...new Set([
    ...checkpoint.artifacts["project-map"].files.map((file) => file.path),
    ...checkpoint.artifacts["implementation-plan"].steps.flatMap((step) => step.files),
  ])].sort(compareText);
}

function containedPath(root: string, path: string): string {
  const candidate = resolve(root, path);
  const fromRoot = relative(root, candidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("project snapshot path escapes the selected project");
  }
  return candidate;
}

function sameComponent(left: ComponentSnapshot, right: ComponentSnapshot): boolean {
  return left.path === right.path && left.dev === right.dev && left.ino === right.ino
    && left.mode === right.mode && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

async function inspectComponents(root: string, portablePath: string): Promise<{
  candidate: string;
  missing: boolean;
  components: ComponentSnapshot[];
}> {
  const candidate = containedPath(root, portablePath);
  const fromRoot = relative(root, candidate);
  const segments = fromRoot === "" ? [] : fromRoot.split(sep);
  const componentPaths = [root];
  for (const segment of segments) componentPaths.push(resolve(componentPaths.at(-1)!, segment));
  const components: ComponentSnapshot[] = [];
  for (const [index, path] of componentPaths.entries()) {
    let metadata;
    try {
      metadata = await lstat(path, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { candidate, missing: true, components };
      throw new Error("project snapshot could not inspect a relevant path");
    }
    if (metadata.isSymbolicLink()) throw new Error("project snapshot path resolves outside the selected project through a symbolic link");
    if (index < componentPaths.length - 1 && !metadata.isDirectory()) {
      throw new Error("project snapshot path has a non-directory component");
    }
    components.push({
      path,
      dev: metadata.dev,
      ino: metadata.ino,
      mode: metadata.mode,
      size: metadata.size,
      mtimeNs: metadata.mtimeNs,
      ctimeNs: metadata.ctimeNs,
    });
  }
  return { candidate, missing: false, components };
}

function sameComponents(before: ComponentSnapshot[], after: ComponentSnapshot[]): boolean {
  return before.length === after.length && before.every((component, index) => sameComponent(component, after[index]!));
}

export async function createProjectSnapshot(
  cwd: string,
  checkpoint: ResumableFeatureCheckpoint,
  signal?: AbortSignal,
): Promise<ProjectSnapshot> {
  signal?.throwIfAborted();
  const root = realpathSync.native(cwd);
  const paths = relevantProjectPaths(checkpoint);
  if (paths.length > MAX_SNAPSHOT_FILES) throw new Error("project snapshot exceeds the file budget");
  const hash = createHash("sha256");
  let totalBytes = 0;
  for (const path of paths) {
    signal?.throwIfAborted();
    const inspected = await inspectComponents(root, path);
    if (inspected.missing) {
      const confirmed = await inspectComponents(root, path);
      if (!confirmed.missing || !sameComponents(inspected.components, confirmed.components)) {
        throw new Error("relevant path changed during project snapshot");
      }
      hash.update(`${JSON.stringify({ path, state: "missing" })}\n`);
      continue;
    }
    const metadata = inspected.components.at(-1)!;
    const file = await lstat(inspected.candidate, { bigint: true });
    if (!file.isFile()) throw new Error("project snapshot paths must name files or planned new files");
    totalBytes += Number(file.size);
    if (totalBytes > MAX_SNAPSHOT_BYTES) throw new Error("project snapshot exceeds the byte budget");
    hash.update(`${JSON.stringify({ path, state: "file", size: Number(file.size), mode: Number(file.mode & 0o777n) })}\n`);
    const handle = await open(inspected.candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat({ bigint: true });
      if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.mode !== metadata.mode
        || opened.size !== metadata.size || opened.mtimeNs !== metadata.mtimeNs || opened.ctimeNs !== metadata.ctimeNs) {
        throw new Error("relevant file changed during project snapshot");
      }
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let position = 0;
      while (position < Number(opened.size)) {
        signal?.throwIfAborted();
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, Number(opened.size) - position), position);
        if (bytesRead === 0) throw new Error("relevant file changed during project snapshot");
        hash.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
      const after = await handle.stat({ bigint: true });
      const reinspected = await inspectComponents(root, path);
      if (reinspected.missing || !sameComponents(inspected.components, reinspected.components)
        || after.dev !== opened.dev || after.ino !== opened.ino || after.mode !== opened.mode
        || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) {
        throw new Error("relevant path changed during project snapshot");
      }
      hash.update("\n");
    } finally {
      await handle.close();
    }
  }
  signal?.throwIfAborted();
  return { algorithm: "sha256-relevant-files-v1", digest: hash.digest("hex"), fileCount: paths.length };
}
