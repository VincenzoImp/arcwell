import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { PACKAGE_CATALOG } from "./catalog.js";
import {
  assertNoSymbolicLinkComponents,
  parseRuntimeConfigJson,
  runtimeConfigFromManifest,
  writeRuntimeConfigAtomic,
} from "./config.js";
import { ARCWELL_VERSION } from "./manifest.js";
import { assertArcwellPackageHealthy } from "./package-health.js";
import {
  ARCWELL_PACKAGE_SOURCE,
  packageSourceIdentity,
  packageSourcesEquivalent,
} from "./package-source.js";
import { createSetupPlan } from "./plan.js";
import { readOwnership, writeOwnershipAtomic, type ArcwellOwnership } from "./ownership.js";
import type { PiClient, PiPackage } from "./pi-client.js";
import type { RuntimeConfig, SetupManifest } from "./types.js";
import {
  mergeWorkingAgreement,
  mergeWorkingAgreementText,
  workingAgreementDigest,
} from "./working-agreement.js";

interface FileSnapshot {
  path: string;
  existed: boolean;
  content?: Buffer;
  mode?: number;
}

export interface ApplySetupDependencies {
  agentDir: string;
  piClient: PiClient;
  workingAgreement: string;
  writeRuntimeConfig?: (path: string, config: RuntimeConfig) => void;
}

function snapshotFile(path: string): FileSnapshot {
  assertNoSymbolicLinkComponents(path);
  if (!existsSync(path)) return { path, existed: false };
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`setup target is a symbolic link: ${path}`);
  if (!stat.isFile()) throw new Error(`setup target is not a regular file: ${path}`);
  return { path, existed: true, content: readFileSync(path), mode: stat.mode & 0o777 };
}

function writeSnapshotAtomic(snapshot: FileSnapshot): void {
  assertNoSymbolicLinkComponents(snapshot.path);
  if (!snapshot.existed) {
    rmSync(snapshot.path, { force: true });
    return;
  }
  const directory = dirname(snapshot.path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertNoSymbolicLinkComponents(directory);
  const temporary = join(directory, `.${basename(snapshot.path)}.${process.pid}.${Date.now()}.restore.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", snapshot.mode ?? 0o600);
    writeFileSync(descriptor, snapshot.content ?? Buffer.alloc(0));
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, snapshot.mode ?? 0o600);
    renameSync(temporary, snapshot.path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

function desiredPackageSources(manifest: SetupManifest): string[] {
  return createSetupPlan(manifest).operations.flatMap((operation) =>
    operation.kind === "install-package" && operation.source ? [operation.source] : []);
}

function assertNoPackageConflicts(desired: readonly string[], installed: readonly PiPackage[]): void {
  for (const source of desired) {
    const identity = packageSourceIdentity(source);
    if (!identity) throw new Error(`setup package source has no package identity: ${source}`);
    const conflict = installed.find((item) =>
      packageSourceIdentity(item.source) === identity && !packageSourcesEquivalent(item.source, source));
    if (conflict) {
      throw new Error(`package identity conflict for ${identity}: found ${conflict.source}, requested ${source}`);
    }
  }
}

function assertNoUnownedDeselectedPackages(
  desired: readonly string[],
  installed: readonly PiPackage[],
  ownedSources: ReadonlySet<string>,
): void {
  const desiredIdentities = new Set(desired.map(packageSourceIdentity));
  for (const entry of PACKAGE_CATALOG) {
    const identity = packageSourceIdentity(entry.source);
    if (!identity || desiredIdentities.has(identity)) continue;
    const unowned = installed.find((item) =>
      item.scope === "user"
      && packageSourceIdentity(item.source) === identity
      && !ownedSources.has(item.source));
    if (unowned) {
      throw new Error(`unowned global package ${unowned.source} remains installed while ${entry.capability} is deselected`);
    }
  }
}

function sameOwnership(left: ArcwellOwnership, right: ArcwellOwnership): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function applySetup(
  manifest: SetupManifest,
  dependencies: ApplySetupDependencies,
  signal?: AbortSignal,
): Promise<ArcwellOwnership> {
  const { agentDir, piClient, workingAgreement } = dependencies;
  const writeConfig = dependencies.writeRuntimeConfig ?? writeRuntimeConfigAtomic;
  const agreementPath = join(agentDir, "AGENTS.md");
  const arcwellDirectory = join(agentDir, "arcwell");
  const configPath = join(arcwellDirectory, "config.json");
  const ownershipPath = join(arcwellDirectory, "ownership.json");
  const desired = desiredPackageSources(manifest);

  const agreementSnapshot = snapshotFile(agreementPath);
  const configSnapshot = snapshotFile(configPath);
  const ownershipSnapshot = snapshotFile(ownershipPath);
  const priorOwnership = readOwnership(ownershipPath);
  const priorAgreement = agreementSnapshot.content?.toString("utf8") ?? "";
  mergeWorkingAgreementText(priorAgreement, workingAgreement);
  const agreementDigest = workingAgreementDigest(workingAgreement);
  const workingAgreementExisted = priorOwnership?.workingAgreementExisted ?? agreementSnapshot.existed;
  const workingAgreementEndedWithNewline = priorOwnership?.workingAgreementEndedWithNewline
    ?? (agreementSnapshot.existed && priorAgreement.endsWith("\n"));
  const arcwellDirectoryExisted = priorOwnership?.arcwellDirectoryExisted ?? existsSync(arcwellDirectory);

  await piClient.version(signal);
  const initiallyInstalled = await piClient.list(signal);
  const priorOwnedSources = new Set(priorOwnership?.installedPackageSources ?? []);
  assertNoPackageConflicts(desired, initiallyInstalled);
  assertNoUnownedDeselectedPackages(desired, initiallyInstalled, priorOwnedSources);
  const initiallyInstalledUserSources = initiallyInstalled
    .filter((item) => item.scope === "user")
    .map((item) => item.source);
  const newlyInstalled: string[] = [];
  const removedPrior: string[] = [];
  const changedFiles: FileSnapshot[] = [];

  try {
    for (const source of desired) {
      if (initiallyInstalledUserSources.some((installedSource) =>
        packageSourcesEquivalent(installedSource, source))) continue;
      // Record the attempt first: a failed Pi/npm command may have changed package
      // files even when it did not persist the settings entry returned by `pi list`.
      newlyInstalled.push(source);
      await piClient.install(source, signal);
      initiallyInstalledUserSources.push(source);
    }

    changedFiles.push(agreementSnapshot);
    mergeWorkingAgreement(agreementPath, workingAgreement);
    changedFiles.push(configSnapshot);
    writeConfig(configPath, runtimeConfigFromManifest(manifest));

    // Disable deselected packages only after the desired config is in place. Remove
    // only sources that a prior Arcwell setup recorded as its own.
    for (const source of priorOwnedSources) {
      if (desired.some((desiredSource) => packageSourcesEquivalent(source, desiredSource))) continue;
      await piClient.remove(source, signal);
      removedPrior.push(source);
    }

    const ownedSources = [...new Set([
      ...[...priorOwnedSources].filter((source) =>
        desired.some((desiredSource) => packageSourcesEquivalent(source, desiredSource))),
      ...newlyInstalled,
    ])];
    const ownership: ArcwellOwnership = {
      schemaVersion: 1,
      arcwellVersion: ARCWELL_VERSION,
      manifestDigest: createSetupPlan(manifest).manifestDigest,
      installedPackageSources: ownedSources,
      selectedPackageSources: [...desired],
      workingAgreementDigest: agreementDigest,
      workingAgreementExisted,
      workingAgreementEndedWithNewline,
      arcwellDirectoryExisted,
    };
    changedFiles.push(ownershipSnapshot);
    writeOwnershipAtomic(ownershipPath, ownership);

    const healthPackages = await piClient.list(signal);
    const healthyPackages = healthPackages.filter((item) => item.scope === "user" && !item.filtered);
    const missing = desired.find((source) => !healthyPackages.some((item) =>
      packageSourcesEquivalent(item.source, source)));
    if (missing) throw new Error(`setup health check: missing package ${missing}`);
    const installedArcwell = healthyPackages.find((item) =>
      packageSourcesEquivalent(item.source, ARCWELL_PACKAGE_SOURCE))!;
    try {
      await assertArcwellPackageHealthy(installedArcwell);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`setup health check: ${detail}`);
    }
    const effectiveConfig = parseRuntimeConfigJson(readFileSync(configPath, "utf8"));
    if (JSON.stringify(effectiveConfig) !== JSON.stringify(runtimeConfigFromManifest(manifest))) {
      throw new Error("setup health check: runtime config mismatch");
    }
    const storedOwnership = readOwnership(ownershipPath);
    if (!storedOwnership || !sameOwnership(storedOwnership, ownership)) {
      throw new Error("setup health check: ownership mismatch");
    }
    if (!readFileSync(agreementPath, "utf8").includes(workingAgreement.trim())) {
      throw new Error("setup health check: working agreement mismatch");
    }
    return ownership;
  } catch (error) {
    const cleanupErrors: string[] = [];
    for (const snapshot of [...changedFiles].reverse()) {
      try { writeSnapshotAtomic(snapshot); }
      catch (cleanupError) { cleanupErrors.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError)); }
    }
    for (const source of [...removedPrior].reverse()) {
      try { await piClient.install(source); }
      catch (cleanupError) { cleanupErrors.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError)); }
    }
    for (const source of [...newlyInstalled].reverse()) {
      try { await piClient.remove(source); }
      catch (cleanupError) { cleanupErrors.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError)); }
    }
    if (!arcwellDirectoryExisted && existsSync(arcwellDirectory)) {
      try {
        assertNoSymbolicLinkComponents(arcwellDirectory);
        const stat = lstatSync(arcwellDirectory);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`setup state directory is not a regular directory: ${arcwellDirectory}`);
        if (readdirSync(arcwellDirectory).length === 0) rmdirSync(arcwellDirectory);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    if (cleanupErrors.length > 0) throw new Error(`${message}; compensation failed: ${cleanupErrors.join("; ")}`);
    throw error;
  }
}
